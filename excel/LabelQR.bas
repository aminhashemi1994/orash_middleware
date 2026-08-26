Attribute VB_Name = "LabelQR"
Option Explicit

' QR code for the product label, drawn by the Orash panel.
'
' Import this module into the label workbook (VBE > File > Import File...) and
' run RefreshLabelQR, or wire it to a button on the «صدور» sheet. It sends the
' three fields the sheet knows to qr.tooscore.ir, gets a PNG back and puts it
' on the sheet; every other field the service demands is fixed on the server,
' in lib/label-qr.js, so it never has to be maintained in two places.
'
'   Z3        کد کالا   (code)
'   C4        سریال      (serial)
'   C5+C6+D9  عنوان کالا (name) — joined with NAME_SEPARATOR
'
' Requires nothing beyond Windows: MSXML and ADODB ship with Office.

Private Const BASE_URL As String = "https://qr.tooscore.ir"
Private Const FALLBACK_URL As String = "http://qr.tooscore.ir"   ' "" to disable

' A certificate that has run out must not stop the production line: the request
' carries a product code and a name, and the server answers the same thing over
' http anyway. So an expired (or not-yet-valid) certificate is tolerated, while
' a certificate for the wrong host or from an unknown authority still fails —
' those are the ones that mean something other than the panel is answering.
' Set TOLERATE_EXPIRED_CERT to False to refuse an expired certificate too.
Private Const TOLERATE_EXPIRED_CERT As Boolean = True
Private Const SHEET_NAME As String = "صدور"
Private Const ANCHOR_RANGE As String = "F7:G10"   ' where the picture is placed
Private Const SHAPE_NAME As String = "LABEL_QR"   ' so a refresh replaces it

' Share of the anchor left as white margin on each side, so the QR keeps the
' quiet zone it needs to scan, and never touches the cell borders.
Private Const MARGIN_RATIO As Double = 0.08
' Below roughly 2cm a handheld scanner has to be held uncomfortably close.
Private Const MIN_SIDE_POINTS As Double = 57
Private Const NAME_SEPARATOR As String = " "

Private Const CELL_CODE As String = "Z3"
Private Const CELL_SERIAL As String = "C4"
Private Const CELLS_NAME As String = "C5,C6,D9"

' Build the QR from the sheet and place it. This is the one to run.
Public Sub RefreshLabelQR()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets(SHEET_NAME)

    Dim code As String, serial As String, goodName As String
    code = CleanCell(ws.Range(CELL_CODE).Value)
    serial = CleanCell(ws.Range(CELL_SERIAL).Value)
    goodName = JoinCells(ws, CELLS_NAME)

    If Len(code) = 0 Or Len(serial) = 0 Or Len(goodName) = 0 Then
        MsgBox "برای ساخت QR این سلول‌ها باید پر باشند:" & vbCrLf & _
               CELL_CODE & " (کد کالا)، " & CELL_SERIAL & " (سریال)، " & CELLS_NAME & " (عنوان کالا)", _
               vbExclamation, "QR لیبل"
        Exit Sub
    End If

    Dim query As String
    query = "/label/qr.png?code=" & UrlEncode(code) & _
            "&serial=" & UrlEncode(serial) & _
            "&name=" & UrlEncode(goodName)

    Dim file As String
    file = Environ$("TEMP") & "\orash-label-qr.png"

    Dim err As String
    err = Download(query, file)
    If Len(err) > 0 Then
        MsgBox "ساخت QR ناموفق بود:" & vbCrLf & err, vbCritical, "QR لیبل"
        Exit Sub
    End If

    PlacePicture ws, file
End Sub

' Delete the QR currently on the sheet.
Public Sub ClearLabelQR()
    RemoveShape ThisWorkbook.Worksheets(SHEET_NAME)
End Sub

' ------------------------------------------------------------------ internals

' Fetches query from BASE_URL into file, and from FALLBACK_URL if TLS itself
' failed. Returns "" on success, otherwise the reason — the server answers a bad
' request in plain Persian, so it is shown as it came.
Private Function Download(ByVal query As String, ByVal file As String) As String
    Dim first As String
    first = Fetch(BASE_URL & query, file)
    If Len(first) = 0 Then Exit Function

    ' Only a transport failure is worth retrying without TLS. An HTTP status
    ' means the panel answered and said no, and asking again in clear text
    ' would get the same no.
    If Len(FALLBACK_URL) > 0 And Left$(first, 5) <> "HTTP " Then
        Dim second As String
        second = Fetch(FALLBACK_URL & query, file)
        If Len(second) = 0 Then Exit Function
        Download = first & vbCrLf & vbCrLf & "بدون TLS هم آزمایش شد: " & second
    Else
        Download = first
    End If
End Function

' SXH_OPTION_IGNORE_SERVER_SSL_CERT_ERROR_FLAGS and the one flag we set on it.
Private Const SXH_OPTION_IGNORE_CERT_ERRORS As Long = 2
Private Const SXH_SERVER_CERT_IGNORE_CERT_DATE_INVALID As Long = 8192

Private Function Fetch(ByVal url As String, ByVal file As String) As String
    Dim http As Object, stream As Object
    On Error GoTo Failed

    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    http.setTimeouts 5000, 5000, 10000, 20000
    http.Open "GET", url, False
    ' setOption only exists on ServerXMLHTTP, and only after Open.
    If TOLERATE_EXPIRED_CERT And LCase$(Left$(url, 6)) = "https:" Then
        On Error Resume Next
        http.setOption SXH_OPTION_IGNORE_CERT_ERRORS, SXH_SERVER_CERT_IGNORE_CERT_DATE_INVALID
        On Error GoTo Failed
    End If
    http.send

    If http.Status <> 200 Then
        Fetch = "HTTP " & http.Status & " — " & http.responseText
        Exit Function
    End If

    Set stream = CreateObject("ADODB.Stream")
    stream.Type = 1                      ' binary
    stream.Open
    stream.Write http.responseBody
    stream.SaveToFile file, 2            ' overwrite
    stream.Close

    Fetch = ""
    Exit Function

Failed:
    Fetch = Err.Description & " (" & url & ")"
End Function

' Puts the picture over ANCHOR_RANGE, square and centred.
'
' The previous QR is left in place until the new one is ready to take its
' position, and is only then replaced. Deleting first meant that any failure
' after that point — a download that fell over, a run cancelled midway — left
' the sheet with no QR at all, and an operator looking at a label that had one
' a moment ago. Overwriting keeps the last good code on the sheet until there
' is a new good code to put there.
'
' MARGIN_RATIO keeps a white margin inside the anchor. A QR printed edge to
' edge against the cell borders loses the quiet zone the symbol needs, and
' scanners start refusing it.
Private Sub PlacePicture(ByVal ws As Worksheet, ByVal file As String)
    Dim box As Range, side As Double, pic As Object, old As Shape
    Set box = ws.Range(ANCHOR_RANGE)
    side = Application.Min(box.Width, box.Height) * (1 - 2 * MARGIN_RATIO)
    If side < MIN_SIDE_POINTS Then side = MIN_SIDE_POINTS

    Set old = FindShape(ws)

    Set pic = ws.Shapes.AddPicture(file, msoFalse, msoTrue, _
        box.Left + (box.Width - side) / 2, box.Top + (box.Height - side) / 2, side, side)

    ' Square regardless of the PNG's own aspect ratio, which LockAspectRatio
    ' would otherwise impose on the height set above.
    pic.LockAspectRatio = msoFalse
    pic.Width = side
    pic.Height = side
    pic.Placement = xlMoveAndSize

    ' Only now is the old one redundant.
    If Not old Is Nothing Then old.Delete
    pic.Name = SHAPE_NAME
End Sub

' The QR currently on the sheet, or Nothing.
Private Function FindShape(ByVal ws As Worksheet) As Shape
    Dim shp As Shape
    For Each shp In ws.Shapes
        If shp.Name = SHAPE_NAME Then
            Set FindShape = shp
            Exit Function
        End If
    Next shp
End Function

Private Sub RemoveShape(ByVal ws As Worksheet)
    Dim shp As Shape
    For Each shp In ws.Shapes
        If shp.Name = SHAPE_NAME Then shp.Delete
    Next shp
End Sub

Private Function CleanCell(ByVal v As Variant) As String
    If IsError(v) Then
        CleanCell = ""
    Else
        CleanCell = Application.WorksheetFunction.Trim(CStr(v))
    End If
End Function

' The name spans several cells; empty ones must not leave a stray separator.
Private Function JoinCells(ByVal ws As Worksheet, ByVal refs As String) As String
    Dim parts() As String, i As Long, piece As String, out As String
    parts = Split(refs, ",")
    For i = LBound(parts) To UBound(parts)
        piece = CleanCell(ws.Range(Trim$(parts(i))).Value)
        If Len(piece) > 0 Then
            If Len(out) > 0 Then out = out & NAME_SEPARATOR
            out = out & piece
        End If
    Next i
    JoinCells = out
End Function

' Percent-encoding of the UTF-8 bytes. VBA strings are UTF-16 and it has no
' encoder of its own, so the text goes through ADODB.Stream to become bytes —
' without this the Persian name arrives at the server mangled.
Private Function UrlEncode(ByVal text As String) As String
    Dim stream As Object, bytes() As Byte, i As Long, b As Integer, out As String

    Set stream = CreateObject("ADODB.Stream")
    stream.Type = 2                      ' text
    stream.Charset = "utf-8"
    stream.Open
    stream.WriteText text
    stream.Position = 0
    stream.Type = 1                      ' read it back as bytes
    stream.Position = 3                  ' skip the BOM ADODB writes
    bytes = stream.Read
    stream.Close

    For i = LBound(bytes) To UBound(bytes)
        b = bytes(i)
        Select Case b
            Case 48 To 57, 65 To 90, 97 To 122, 45, 46, 95, 126   ' 0-9 A-Z a-z - . _ ~
                out = out & Chr$(b)
            Case Else
                out = out & "%" & Right$("0" & Hex$(b), 2)
        End Select
    Next i

    UrlEncode = out
End Function

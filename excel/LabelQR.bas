Dim mat() As Byte                           ' matrix of QR
' ---------------------------------------------------------------- LabelQR
' Where the label fields live on the issuing sheet, and everything CreateGood
' requires beyond them. The fixed values mirror FIXED in lib/label-qr.js on the
' panel - change them in both places, or the sheet and the panel disagree about
' what a label means.
'
' These are module-level declarations, so they belong here in the Declarations
' section: VBA rejects a Const that appears after the first procedure.
Private Const LQ_SHEET As String = "صدور"
Private Const LQ_CELL_CODE As String = "Z3"
Private Const LQ_CELL_SERIAL As String = "C4"
Private Const LQ_CELL_LENGTH As String = "D7"      ' متراژ کابل — یک عدد
Private Const LQ_CELLS_NAME As String = "C5,C6,D9"
Private Const LQ_SEPARATOR As String = " "
Private Const LQ_MODE As String = "L"          ' این QR از لیبل ساخته شده

' The QR carries only what this sheet knows: code, name, serial and the
' cable's length in metres. The reference codes CreateGood also needs — type,
' unit, packing, main and second group — are added by the panel when the good
' is registered, so a label stays valid if those change.

Private Sub CheckBox1_Click()
End Sub

Private Sub UserForm_Initialize()
    Application.Visible = False
End Sub

Private Sub CommandButton1_Click() 'صدور
ActiveWorkbook.Save
On Error Resume Next
Sheet1.Shapes("qrpic0").Delete
On Error Resume Next
Sheet5.Shapes("qrpic1").Delete
On Error Resume Next
Sheet14.Shapes("qrpic2").Delete


If Sheet1.Cells(3, 5) = "" Then
 If MsgBox("تاريخ وارد نشده است ، آيا ادامه ميدهيد ؟ ", vbYesNo) = vbNo Then
  GoTo EN
End If
End If

If Sheet1.Cells(9, 4) = "" Then
 If MsgBox("رنگ محصول وارد نشده است ، آيا ادامه ميدهيد ؟", vbYesNo) = vbNo Then
  GoTo EN
End If
End If

If Sheet1.Cells(4, 6) = "" Then
 If MsgBox("کد کالا وارد نشده است ، آيا ادامه ميدهيد ؟", vbYesNo) = vbNo Then
  GoTo EN
End If
End If

If Sheet1.Cells(4, 3) = "" Then
 If MsgBox("سريال توليد وارد نشده است ، آيا ادامه ميدهيد ؟", vbYesNo) = vbNo Then
  GoTo EN
End If
End If

If Sheet1.Cells(7, 4) = "" Then
 If MsgBox("طول سيم/کابل وارد نشده است ، آيا ادامه ميدهيد ؟", vbYesNo) = vbNo Then
  GoTo EN
End If
End If

If Sheet1.Cells(8, 4) = "" Then
If MsgBox("وزن کالا وارد نشده است ، آيا ادامه ميدهيد ؟", vbYesNo) = vbNo Then
  GoTo EN
End If
End If
 
D = Left(Sheet1.Cells(4, 6), 1)

a = Len(Sheet1.Cells(4, 6))
If D = "Z" Or D = "z" Then
 a = a - 1
End If
e = Right(Sheet1.Cells(4, 6), a)
Sheet1.Cells(1, 1) = e

For X = 1 To 9999 'جستجوي کالا در ديتابيس
 If Sheet1.Cells(1, 1) = Sheet6.Cells(X, 1) Then
  Sheet1.Cells(3, 14) = Sheet6.Cells(X, 8)
  Sheet1.Cells(3, 16) = Sheet6.Cells(X, 7)
  Sheet1.Cells(3, 19) = Sheet6.Cells(X, 3)
  Sheet1.Cells(3, 20) = Sheet6.Cells(X, 2)
  Sheet1.Cells(3, 25) = Sheet6.Cells(X, 4)
  Exit For
 End If
 If X = 9999 Then
  MsgBox "کالا در ديتابيس يافت نشد" & vbNewLine & vbNewLine & "به همين دليل امکان بررسي نسبت وزن و متراژ وجود ندارد"
  GoTo ER3
 End If
Next

If D <> "Z" And D <> "z" Then
If Sheet1.Cells(5, 3) <> Sheet1.Cells(3, 19) Then
 If MsgBox("کد کالا با نام کالا مغايرت دارد ، آيا ادامه ميدهيد ؟", vbYesNo) = vbNo Then
  GoTo EN
 End If
End If
End If

If D <> "Z" And D <> "z" Then
If Sheet1.Cells(6, 3) <> Sheet1.Cells(3, 20) Then
 If MsgBox("کد کالا با سايز کالا مغايرت دارد ، آيا ادامه ميدهيد ؟", vbYesNo) = vbNo Then
  GoTo EN
 End If
End If
End If

ER3:

On Error Resume Next
a = Range("c10:e10").Find(What:=Sheet8.Cells(2, 9))
AA = Range("C5:g5").Find(What:=Sheet8.Cells(2, 9))
On Error Resume Next
b = Range("c10:e10").Find(What:=Sheet8.Cells(3, 9))
BB = Range("C5:g5").Find(What:=Sheet8.Cells(3, 9))
On Error Resume Next
c = Range("c10:e10").Find(What:=Sheet8.Cells(4, 9))
CC = Range("C5:g5").Find(What:=Sheet8.Cells(4, 9))
On Error Resume Next
D = Range("c10:e10").Find(What:=Sheet8.Cells(5, 9))
DD = Range("C5:g5").Find(What:=Sheet8.Cells(5, 9))
On Error Resume Next
e = Range("c10:e10").Find(What:=Sheet8.Cells(6, 9))
EE = Range("C5:g5").Find(What:=Sheet8.Cells(6, 9))
On Error Resume Next
F = Range("c10:e10").Find(What:=Sheet8.Cells(7, 9))
FF = Range("C5:g5").Find(What:=Sheet8.Cells(7, 9))
On Error Resume Next
G = Range("c10:e10").Find(What:=Sheet8.Cells(8, 9))
GG = Range("C5:g5").Find(What:=Sheet8.Cells(8, 9))
On Error Resume Next
H = Range("c10:e10").Find(What:=Sheet8.Cells(9, 9))
HH = Range("C5:g5").Find(What:=Sheet8.Cells(9, 9))
On Error Resume Next
i = Range("c10:e10").Find(What:=Sheet8.Cells(10, 9))
II = Range("C5:g5").Find(What:=Sheet8.Cells(10, 9))
On Error Resume Next
j = Range("c10:e10").Find(What:=Sheet8.Cells(11, 9))
JJ = Range("C5:g5").Find(What:=Sheet8.Cells(11, 9))

If Sheet1.Cells(2, 2) <> "" Or Sheet1.Shapes("standard").Visible = True Then
 If a <> "" Or b <> "" Or c <> "" Or D <> "" Or e <> "" Or F <> "" Or G <> "" Or H <> "" Or i <> "" Or j <> "" Or AA <> "" Or BB <> "" Or CC <> "" Or DD <> "" Or EE <> "" Or FF <> "" Or GG <> "" Or HH <> "" Or II <> "" Or JJ <> "" Then
  If MsgBox("شما نميتوانيد کالاهاي مصرف داخلي يا زيري را در قالب استاندارد صادر نماييد" & vbNewLine & vbNewLine & "جهت اطلاع از موارد مغاير با استاندارد ، به شيت ديتابيس (جدول موارد ممنوعه براي استاندارد ليبل) مراجعه نماييد" & vbNewLine & vbNewLine & "آيا فرمت ليبل به غير استاندارد تغيير کند ؟", vbYesNo) = vbYes Then
   Sheet1.Shapes("standard").Visible = FULSE
   Sheet1.Shapes("SHAPE 5").Visible = True
   Sheet1.Shapes("SHAPE 4").Visible = FULSE
   Sheet1.Shapes("SHAPE 3").Visible = True
   Sheet1.Cells(2, 2) = ""
   Sheet1.Cells(3, 2) = ""
   Sheet5.Cells(1, 2).Interior.ColorIndex = 0 ' no fiel
  Else
   GoTo EN
  End If
 End If
End If

p = Sheet6.Cells(X, 9)
 q = (Sheet1.Cells(8, 4) - (Sheet1.Cells(7, 4) * (Sheet1.Cells(3, 25) / 1000))) / ((Sheet1.Cells(7, 4) * (Sheet1.Cells(3, 25) / 1000)) / 100)
 q = Round(q)
 If q = 0 Then
  MsgBox "وزن طرح کيفي پيدا نشد" & vbNewLine & vbNewLine & "به همين دليل برامه نميتواند نسب وزن با متراژ را محاسبه کند"
 End If
 
 If q < -10 Or q > 10 Then
  If q < -100 Or q > 100 Then
   If MsgBox("با توجه به اختلاف زياد نسبت وزن به متراژ ، به نظر ميرسد وزن طرح کيفي اشتباه است" & vbNewLine & "به هر حال" & vbNewLine & vbNewLine & vbNewLine & "اختلاف مغايرت وزن و متراژ وارد شده بيش از حد مجاز" & "   ( " & q & " )   " & "ميباشد" & vbNewLine & vbNewLine & p & vbNewLine & vbNewLine & "آيا از صحت متراژ و وزن محصول اطمينان داريد ؟", vbYesNo) = vbNo Then
    GoTo EN
   End If
  Else
   If MsgBox("وزن و متراژ وارد شده بيش از حد مجاز" & "   ( " & q & " )   " & "مغايرت دارند" & vbNewLine & vbNewLine & p & vbNewLine & vbNewLine & "آيا از صحت متراژ و وزن محصول اطمينان داريد ؟", vbYesNo) = vbNo Then
    GoTo EN
   End If
  End If
 End If
 
 myValue = InputBox("ميخواهيد چه تعداد ليبل چاپ نماييد ؟")
 
 If myValue = "" Then
  GoTo EN
 End If
 
 For i = 3 To 9999
 If Sheet2.Cells(i, 1) = "" And Sheet2.Cells(i, 2) = "" Then
 j = i - 2
 Sheet1.Cells(3, 6).Value = j 'سريال روي پلاک
 Sheet2.Cells(i, 1).Value = j 'سريال LAB
 Sheet2.Cells(i, 2) = Sheet1.Cells(3, 5) 'تاريخ
 Sheet2.Cells(i, 3) = Sheet1.Cells(4, 3) ' سريال توليد
 Sheet2.Cells(i, 4) = Sheet1.Cells(4, 6) 'کد کالا
 Sheet2.Cells(i, 5) = Sheet1.Cells(5, 3) 'نوع کالا
 Sheet2.Cells(i, 6) = Sheet1.Cells(6, 3) 'سايز
 Sheet2.Cells(i, 7) = Sheet1.Cells(7, 4) 'طول
 Sheet2.Cells(i, 8) = Sheet1.Cells(8, 4) 'وزن
 Sheet2.Cells(i, 9) = Sheet1.Cells(9, 4) ' رنگ
 Sheet2.Cells(i, 11) = Sheet1.Cells(10, 3) 'توضيحات
 Sheet2.Cells(i, 12) = Sheet1.Cells(12, 3) 'بسته بند
 Sheet2.Cells(i, 13) = Sheet1.Cells(12, 6) 'صادر کننده
 Sheet2.Cells(i, 14) = myValue
 
 If Sheet1.Cells(3, 16) = 0 Or Sheet1.Cells(2, 2) = "" Then
  Sheet2.Cells(i, 10) = "بدون استاندارد"
  GoTo NEX
 Else
  Sheet2.Cells(i, 10) = Sheet1.Cells(3, 16) 'وضعيت استاندارد
  GoTo NEX
 End If
 
 GoTo NEX
End If
Next

NEX:
'''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''
'''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''
'''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''

''''''''''''''''''''''''' تشکيل بارکد '''''''''''''''''
a = ""

For b = 1 To 12
For c = 3 To 14
If Sheet8.Cells(c, 11) = b Then
 BB = Sheet8.Cells(c, 12)
 Select Case BB
 
 Case Sheet8.Cells(3, 12) 'سريال توليد
 a = a & " " & Sheet1.Cells(4, 3)

 Case Sheet8.Cells(4, 12) 'کد کالا
 a = a & " " & Sheet1.Cells(4, 6)

 Case Sheet8.Cells(5, 12) ' سريال ليبل
 a = a & " " & Sheet1.Cells(3, 7) & Sheet1.Cells(3, 6)

 Case Sheet8.Cells(6, 12) ' نام کالا
 a = a & " " & Sheet1.Cells(5, 3)

 Case Sheet8.Cells(7, 12) ' سايز کالا
 a = a & " " & Sheet1.Cells(6, 3)

 Case Sheet8.Cells(8, 12) ' متراژ
 a = a & " " & Sheet1.Cells(7, 4)

 Case Sheet8.Cells(9, 12) ' وزن
 a = a & " " & Sheet1.Cells(8, 4)

 Case Sheet8.Cells(10, 12) ' توضيحات
 a = a & " " & Sheet1.Cells(10, 3)

 Case Sheet8.Cells(11, 12) ' شماره استاندارد
 a = a & " " & Sheet1.Cells(2, 2)

 Case Sheet8.Cells(12, 12) ' تاريخ ليبل
 a = a & " " & Sheet1.Cells(3, 5)

 Case Sheet8.Cells(13, 12) ' نام اپراتور
 a = a & " " & Sheet1.Cells(12, 3)

 Case Sheet8.Cells(14, 12) ' صادر کننده
 a = a & " " & Sheet1.Cells(12, 6)

 End Select
End If
Next
Next

Sheet1.Cells(1, 3) = a
Sheet1.Cells(1, 1) = "OK"
''''''''''''''''''''''''''''''''''''''''

If Sheet1.Cells(3, 19) = 0 Or Sheet1.Cells(3, 20) = 0 Then
 GoTo ER2
End If

D = Left(Sheet1.Cells(4, 6), 1)

a = Len(Sheet1.Cells(4, 6))
If D = "Z" Or D = "z" Then
 a = a - 1
End If
e = Right(Sheet1.Cells(4, 6), a)
Sheet1.Cells(1, 2) = e

For X = 1 To 9999 'جستجوي کالا در ديتابيس
 If Sheet1.Cells(1, 2) = Sheet6.Cells(X, 1) Then
  Sheet1.Cells(3, 14) = Sheet6.Cells(X, 8)
  Sheet1.Cells(3, 16) = Sheet6.Cells(X, 7)
  Sheet1.Cells(3, 19) = Sheet6.Cells(X, 3)
  Sheet1.Cells(3, 20) = Sheet6.Cells(X, 2)
  Exit For
 End If
 If X = 9999 Then
  MsgBox "کالا در ديتابيس يافت نشد"
 End If
Next

ER2:
''''''''''''''''''''' جاي گذاري شيت استاندارد بدون لوگو ''''''''''''''''''''''

Sheet5.Cells(5, 3) = Sheet1.Cells(5, 3) 'نوع محصول
Sheet5.Cells(6, 3) = Sheet1.Cells(6, 3) 'سايز
Sheet5.Cells(10, 3) = Sheet1.Cells(4, 3) 'سريال توليد
Sheet5.Cells(7, 4) = Sheet1.Cells(7, 4) 'طول
Sheet5.Cells(8, 4) = Sheet1.Cells(8, 4) 'وزن
Sheet5.Cells(11, 3) = Sheet1.Cells(4, 6) 'کد محصول
Sheet5.Cells(9, 3) = Sheet1.Cells(9, 4) 'رنگ
Sheet5.Cells(4, 2) = Sheet1.Cells(3, 5) 'تاريخ
Sheet5.Cells(4, 4) = Sheet1.Cells(3, 6) 'سريال ليبل
Sheet5.Cells(1, 2) = Sheet1.Cells(2, 2) 'شمره 10 رقمي استاندارد
Sheet5.Cells(12, 3) = Sheet1.Cells(10, 3) 'توضيحات

''''''''''''''''''''' جاي گذاري شيت استاندارد لوگو دار ''''''''''''''''''''''

Sheet14.Cells(4, 5) = Sheet1.Cells(5, 3) 'نوع محصول
Sheet14.Cells(5, 5) = Sheet1.Cells(6, 3) 'سايز
Sheet14.Cells(9, 5) = Sheet1.Cells(4, 3) 'سريال توليد
Sheet14.Cells(6, 5) = Sheet1.Cells(7, 4) 'طول
Sheet14.Cells(7, 5) = Sheet1.Cells(8, 4) 'وزن
Sheet14.Cells(8, 5) = Sheet1.Cells(9, 4) 'رنگ
Sheet14.Cells(3, 4) = Sheet1.Cells(3, 5) 'تاريخ
Sheet14.Cells(3, 6) = Sheet1.Cells(3, 6) 'سريال ليبل
Sheet14.Cells(10, 2) = Sheet1.Cells(2, 2) 'شمره 10 رقمي استاندارد
Sheet14.Cells(13, 3) = Sheet1.Cells(10, 3) 'توضيحات

On Error Resume Next
a = Range("c10:e10").Find(What:=Sheet8.Cells(2, 9))
AA = Range("C5:g5").Find(What:=Sheet8.Cells(2, 9))
On Error Resume Next
b = Range("c10:e10").Find(What:=Sheet8.Cells(3, 9))
BB = Range("C5:g5").Find(What:=Sheet8.Cells(3, 9))
On Error Resume Next
c = Range("c10:e10").Find(What:=Sheet8.Cells(4, 9))
CC = Range("C5:g5").Find(What:=Sheet8.Cells(4, 9))
On Error Resume Next
D = Range("c10:e10").Find(What:=Sheet8.Cells(5, 9))
DD = Range("C5:g5").Find(What:=Sheet8.Cells(5, 9))
On Error Resume Next
e = Range("c10:e10").Find(What:=Sheet8.Cells(6, 9))
EE = Range("C5:g5").Find(What:=Sheet8.Cells(6, 9))
On Error Resume Next
F = Range("c10:e10").Find(What:=Sheet8.Cells(7, 9))
FF = Range("C5:g5").Find(What:=Sheet8.Cells(7, 9))
On Error Resume Next
G = Range("c10:e10").Find(What:=Sheet8.Cells(8, 9))
GG = Range("C5:g5").Find(What:=Sheet8.Cells(8, 9))
On Error Resume Next
H = Range("c10:e10").Find(What:=Sheet8.Cells(9, 9))
HH = Range("C5:g5").Find(What:=Sheet8.Cells(9, 9))
On Error Resume Next
i = Range("c10:e10").Find(What:=Sheet8.Cells(10, 9))
II = Range("C5:g5").Find(What:=Sheet8.Cells(10, 9))
On Error Resume Next
j = Range("c10:e10").Find(What:=Sheet8.Cells(11, 9))
JJ = Range("C5:g5").Find(What:=Sheet8.Cells(11, 9))

If Sheet1.Cells(2, 2) <> "" Or Sheet1.Shapes("standard").Visible = True Then
 If a <> "" Or b <> "" Or c <> "" Or D <> "" Or e <> "" Or F <> "" Or G <> "" Or H <> "" Or i <> "" Or j <> "" Or AA <> "" Or BB <> "" Or CC <> "" Or DD <> "" Or EE <> "" Or FF <> "" Or GG <> "" Or HH <> "" Or II <> "" Or JJ <> "" Then
 If MsgBox("شما نميتوانيد کالاهاي مصرف داخلي يا زيري را در قالب استاندارد صادر نماييد" & vbNewLine & vbNewLine & "جهت اطلاع از موارد مغاير با استاندارد ، به شيت ديتابيس (جدول موارد ممنوعه براي استاندارد ليبل) مراجعه نماييد" & vbNewLine & vbNewLine & "آيا فرمت ليبل به غير استاندارد تغيير کند ؟", vbYesNo) = vbYes Then
   Sheet1.Shapes("standard").Visible = FULSE
   Sheet1.Shapes("SHAPE 5").Visible = True
   Sheet1.Shapes("SHAPE 4").Visible = FULSE
   Sheet1.Shapes("SHAPE 3").Visible = True
   Sheet1.Cells(2, 2) = ""
   Sheet1.Cells(3, 2) = ""
  Else
   GoTo EEN
  End If
 End If
End If
'''''''''''''''''''''''' بررسي عيب کالاي توضيحات دار ''''''''''''''''''''''
'On Error Resume Next
'a = Range("c10:e10").Find(What:=Sheet8.Cells(2, 9))
'AA = Range("C5:g5").Find(What:=Sheet8.Cells(2, 9))
'On Error Resume Next
'b = Range("c10:e10").Find(What:=Sheet8.Cells(3, 9))
'BB = Range("C5:g5").Find(What:=Sheet8.Cells(3, 9))
'On Error Resume Next
'c = Range("c10:e10").Find(What:=Sheet8.Cells(4, 9))
'CC = Range("C5:g5").Find(What:=Sheet8.Cells(4, 9))
'On Error Resume Next
'd = Range("c10:e10").Find(What:=Sheet8.Cells(5, 9))
'DD = Range("C5:g5").Find(What:=Sheet8.Cells(5, 9))
'On Error Resume Next
'e = Range("c10:e10").Find(What:=Sheet8.Cells(6, 9))
'EE = Range("C5:g5").Find(What:=Sheet8.Cells(6, 9))
'On Error Resume Next
'F = Range("c10:e10").Find(What:=Sheet8.Cells(7, 9))
'FF = Range("C5:g5").Find(What:=Sheet8.Cells(7, 9))
'On Error Resume Next
'G = Range("c10:e10").Find(What:=Sheet8.Cells(8, 9))
'GG = Range("C5:g5").Find(What:=Sheet8.Cells(8, 9))
'On Error Resume Next
'H = Range("c10:e10").Find(What:=Sheet8.Cells(9, 9))
'HH = Range("C5:g5").Find(What:=Sheet8.Cells(9, 9))
'On Error Resume Next
'i = Range("c10:e10").Find(What:=Sheet8.Cells(10, 9))
'II = Range("C5:g5").Find(What:=Sheet8.Cells(10, 9))
'On Error Resume Next
'j = Range("c10:e10").Find(What:=Sheet8.Cells(11, 9))
'JJ = Range("C5:g5").Find(What:=Sheet8.Cells(11, 9))

'If a <> "" Or b <> "" Or c <> "" Or d <> "" Or e <> "" Or F <> "" Or G <> "" Or H <> "" Or i <> "" Or j <> "" Or AA <> "" Or BB <> "" Or CC <> "" Or DD <> "" Or EE <> "" Or FF <> "" Or GG <> "" Or HH <> "" Or II <> "" Or JJ <> "" Then
' X = InputBox("به چه دليلي اين کالا" & "  " & Sheet1.Cells(10, 3) & "  " & "شده است ؟")
' If X <> "" Then
'  Sheet1.Cells(10, 3) = Sheet1.Cells(10, 3) & " - " & X 'مصرف داخلي به دليل اينکه
  'Sheet1.Cells(9, 2).Font.Name = "Calibri"
  'Sheet14.Cells(11, 5) = Sheet1.Cells(10, 3) & " - " & X 'توضيحات
'  Sheet5.Cells(12, 3) = Sheet1.Cells(10, 3) '& " - " & X 'توضيحات
'  Sheet14.Cells(11, 5) = Sheet1.Cells(4, 6) 'کد محصول

  
 ' For w = 3 To 9999
 'If Sheet1.Cells(3, 6) = Sheet2.Cells(w, 1) Then
 ' Sheet2.Cells(w, 15) = Sheet2.Cells(w, 15) & "  -  " & X
 '  Exit For
 ' End If
 ' Next
  
' Else
'   GoTo EEN
' End If
'Else
 'Sheet1.Cells(9, 2).Font.Name = "Bar-Code 39"
'End If
'''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''
If Sheet1.Cells(4, 3) = "" Then
 GoTo QQQ
End If

If Sheet1.Cells(3, 17) = 0 And Sheet1.Cells(3, 18) = 0 Or Sheet1.Cells(4, 6) = "-" Then
 GoTo QQQ
End If

If Sheet1.Cells(3, 17) = 0 And Sheet1.Cells(3, 18) = 0 Or Sheet1.Cells(4, 6) = "-" Then
 GoTo QQQ
End If

QQQ:
''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''' ايجاد qr code ''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''
    txt = LabelPayloadJson()
    If txt = "" Then Exit Sub
    Dim lev As Byte
    
    version = 0
    l = Len(txt)
    w = l * 8
    p = Array(8, 16, 16)                                                                 ' error correction words L,M,Q,H and blocks
    
    ecw = Array(Array(2, 5, 6, 8, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30), _
        Array(99, 6, 8, 10, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28), _
        Array(99, 99, 99, 14, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30), _
        Array(99, 99, 99, 99, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30))
    ecb = Array(Array(1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25), _
        Array(1, 1, 1, 1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49), _
        Array(1, 1, 1, 1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68), _
        Array(1, 1, 1, 1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81))

    Do                                                                                                ' compute QR size
        version = version + 1
        If version + 3 > UBound(ecb(0)) Then Exit Sub
        
        s = version * 4 + 17                                                                 ' symbol size
        j = ecb(lev)(version + 3) * ecw(lev)(version + 3)                     ' error correction
        a = IIf(version < 2, 0, version \ 7 + 2)                                      ' # of align pattern
        
        el = (s - 1) * (s - 1) - (5 * a - 1) * (5 * a - 1)                            ' total bits - align - timing
        el = el - IIf(version < 2, 191, IIf(version < 7, 136, 172))           ' finder, version, format
        k = p((version + 7) \ 17)                                                            ' count indicator bits
    Loop While (el And -8) - 8 * j < w + 4 + k

    For lev = lev To 2                                                                          ' increase security level if data still fits
        j = ecb(lev + 1)(version + 3) * ecw(lev + 1)(version + 3)
        If (el And -8) - 8 * j < w + 4 + k Then Exit For
    Next
    
    blk = ecb(lev)(version + 3)         ' # of error correction blocks
    ec = ecw(lev)(version + 3)         ' # of error correction bytes
    el = el \ 8 - ec * blk                    '    data capacity
    w = el \ blk                                 ' # of words in group 1
    b = blk + w * blk - el                  ' # of blocks in group 1

    ReDim enc(el + ec * blk) As Byte, mat(s - 1, s - 1) As Byte
    
    c = 0                                                               ' encode head indicator bits
    eb = 4 + k
    v = 4 * 2 ^ k + l                                    ' character count indicator
    
    For i = 1 To l                                                      ' encode data
        v = v * 256 + Asc(Mid(txt, i, 1))
        eb = eb + 8
        For eb = eb To 8 Step -8                                ' add data to bit stream
            j = 2 ^ (eb - 8)
            enc(c) = v \ j
            v = v - enc(c) * j
            c = c + 1
        Next
    Next
    
    If el > c Then
        v = v * 16
        eb = eb + 4                                                         ' terminator
    End If
    
    enc(c) = (v * 256) \ 2 ^ eb
    c = c + 1
    enc(c) = ((v * 65536) \ 2 ^ eb) And 255
    If eb > 8 And el >= c Then c = c + 1                                            ' bit padding
    If (version And -3) = -3 And el = c Then enc(c) = enc(c) \ 16       ' M1,M3: shift high bits to low nibble
    
    i = 236
    For c = c To el - 1                                                                         ' byte padding
        enc(c) = IIf((version And -3) = -3 And c = el - 1, 0, i)
        i = i Xor 236 Xor 17
    Next c
    
    ReDim RS(ec + 1) As Integer                                                         ' compute Reed Solomon error detection and correction
    Dim lg(256) As Integer, ex(255) As Integer                                  ' log/exp table
    j = 1
    For i = 0 To 254
        ex(i) = j
        lg(j) = i                                                                                ' compute log/exp table of Galois field
        j = j + j
        If j > 255 Then j = j Xor 285                                                ' GF polynomial a^8+a^4+a^3+a^2+1 = 100011101b = 285
    Next i
    
    RS(0) = 1                                                                                       ' compute RS generator polynomial
    For i = 0 To ec - 1
        RS(i + 1) = 0
        For j = i + 1 To 1 Step -1
            RS(j) = RS(j) Xor ex((lg(RS(j - 1)) + i) Mod 255)
        Next j
    Next i
    
    eb = el: k = 0
    For c = 1 To blk                                                                            ' compute RS correction data for each block
        For i = IIf(c <= b, 1, 0) To w
            X = enc(eb) Xor enc(k)
            For j = 1 To ec
                enc(eb + j - 1) = enc(eb + j) Xor IIf(X, ex((lg(RS(j)) + lg(X)) Mod 255), 0)
            Next j
            k = k + 1
        Next i
        eb = eb + ec
    Next c
                                                                                                        ' fill QR matrix
    For i = 8 To s - 1                                                                          ' timing pattern
        mat(i, 6) = i And 1 Xor 3
        mat(6, i) = i And 1 Xor 3
    Next i
    
    If version > 6 Then                                                                         ' reserve version area
        For i = 0 To 17
            mat(i \ 3, s - 11 + i Mod 3) = 2
            mat(s - 11 + i Mod 3, i \ 3) = 2
        Next i
    End If
    
    If a < 2 Then a = 2
    For X = 1 To a                                                                                  ' layout finder/align pattern
        For Y = 1 To a
            If X = 1 And Y = 1 Then                                                             ' finder upper left
                i = 0
                j = 0
                p = Array(383, 321, 349, 349, 349, 321, 383, 256, 511)
            ElseIf X = 1 And Y = a Then                                                         ' finder lower left
                i = 0
                j = s - 8
                p = Array(256, 383, 321, 349, 349, 349, 321, 383)
            ElseIf X = a And Y = 1 Then                                                         ' finder upper right
                i = s - 8
                j = 0
                p = Array(254, 130, 186, 186, 186, 130, 254, 0, 255)
            Else                                                                                            ' alignment grid
                c = 2 * Int(2 * (version + 1) / (1 - a))                                    ' pattern spacing
                i = IIf(X = 1, 4, s - 9 + c * (a - X))
                j = IIf(Y = 1, 4, s - 9 + c * (a - Y))
                p = Array(31, 17, 21, 17, 31)                                               ' alignment pattern
            End If
            
            If version <> 1 Or X + Y < 4 Then                                               ' no align pattern for version 1
                For c = 0 To UBound(p)                                                          ' set fixed pattern, reserve space
                    m = p(c)
                    k = 0
                    Do
                        mat(i + k, j + c) = (m And 1) Or 2
                        m = m \ 2
                        k = k + 1
                    Loop While 2 ^ k <= p(0)
                Next c
            End If
        Next Y
    Next X
    
    X = s
    Y = s - 1                                                                                               ' layout codewords
    For i = 0 To eb - 1
        c = 0
        k = 0
        j = w + 1                                                                                           ' interleave data
        If i >= el Then
            c = el
            k = el
            j = ec                                                                                              ' interleave checkwords
        ElseIf i + blk - b >= el Then
            c = -b
            k = c                                                                                                   ' interleave group 2 last bytes
        ElseIf (i Mod blk) >= b Then
            c = -b                                                                                                  ' interleave group 2
        Else
            j = j - 1                                                                                                ' interleave group 1
        End If
        c = enc(c + ((i - k) Mod blk) * j + (i - k) \ blk)                                           ' interleave data
        
        For j = IIf((-3 And version) = -3 And i = el - 1, 3, 7) To 0 Step -1            ' M1,M3: 4 bit
            k = IIf(version > 0 And X < 6, 1, 0)                                                    ' skip vertical timing pattern
            Do                                                                                                      ' advance x,y
                X = X - 1
                If 1 And (X + 1) Xor k Then
                    If s - X - k And 2 Then
                        If Y > 0 Then Y = Y - 1: X = X + 2                                              ' up, top turn
                    Else
                        If Y < s - 1 Then Y = Y + 1: X = X + 2                                          ' down, bottom turn
                    End If
                End If
            Loop While mat(X, Y) And 2                                                                  ' skip reserved area
            If c And 2 ^ j Then mat(X, Y) = 1
        Next j
    Next i

    m = 0
    p = 1000000                                                                             ' data masking
    For k = 0 To 7
        l = 0
        k2 = ""
        j = 0
        For Y = 0 To s - 1                                                                  ' horizontal
            c = 0
            i = 0
            k1 = "0000"
            For X = 0 To s - 1
                w = getPattern(X, Y, k, version)
                l = l + w
                k1 = k1 & w                                                              ' rule 4: count darks
                If c = w Then                                                               ' same as prev
                    i = i + 1
                    If X And Mid(k2, X + 4, 2) = c & c Then j = j + 3       ' rule 2: block 2x2
                Else
                    If i > 5 Then j = j + i - 2                                             ' rule 1: >5 adjacent
                    c = 1 - c
                    i = 1
                End If
            Next X
            If i > 5 Then j = j + i - 2                                                     ' rule 1: >5 adjacent
            
            i = 0
            Do                                                                                      ' rule 3: like finder pattern
                i = InStr(i + 4, k1, "1011101")
                If i < 1 Then Exit Do
                If Mid(k1, i - 4, 4) = "0000" Or Mid(k1 & "0000", i + 7, 4) = "0000" Then j = j + 40
            Loop
            k2 = k1                                                                                 ' rule 2: remember last line
        Next Y
            
        For X = 0 To s - 1                                                                  ' vertical
            c = 0
            i = 0
            k1 = "0000"
            For Y = 0 To s - 1
                w = getPattern(X, Y, k, version)
                k1 = k1 & w                                                                 ' vertical to string
                If c = w Then                                                                 ' same as prev
                    i = i + 1
                Else
                    If i > 5 Then j = j + i - 2                                             ' rule 1: >5 adjacent
                    c = 1 - c: i = 1
                End If
            Next Y
            If i > 5 Then j = j + i - 2                                                       ' rule 1: >5 adjacent
            
            i = 0
            Do                                                                                      ' rule 3: like finder pattern
                i = InStr(i + 4, k1, "1011101")
                If i < 1 Then Exit Do
                If Mid(k1, i - 4, 4) = "0000" Or Mid(k1 & "0000", i + 7, 4) = "0000" Then j = j + 40
            Loop
        Next X
        j = j + Int(Abs(10 - 20 * l / (s * s))) * 10                                ' rule 4: darks
        
        If j < p Then
            p = j
            m = k
        End If                                                                                      ' take mask of lower penalty
    Next k
                                                                                                      ' add format information, code level and mask
    j = IIf(version = -3, m, ((5 - lev) And 3) * 8 + m)
    j = j * 1024
    k = j
    For i = 4 To 0 Step -1                                                          ' BCH error correction: 5 data, 10 error bits
        If j >= 1024 * 2 ^ i Then j = j Xor 1335 * 2 ^ i
    Next i                                                                                  ' generator polynom: x^10+x^8+x^5+x^4+x^2+x+1 = 10100110111b = 1335
    
    k = k Xor j Xor 21522                                                         ' XOR masking
    For j = 0 To 14                                                                                 ' layout format information
        mat(IIf(j < 8, s - j - 1, IIf(j = 8, 7, 14 - j)), 8) = k And 1 Xor 2    ' QR horizontal
        mat(8, IIf(j < 6, j, IIf(j < 8, j + 1, s + j - 15))) = k And 1 Xor 2    ' vertical
        k = k \ 2
    Next

    If version > 6 Then                                                         ' add version information
        k = version * 4096&
        For i = 5 To 0 Step -1                                                  ' BCH error correction: 6 data, 12 error bits
            If k >= 4096 * 2 ^ i Then k = k Xor 7973 * 2 ^ i
        Next
                                                                                            ' generator polynom: x^12+x^11+x^10+x^9+x^8+x^5+x^2+1 = 1111100100101b = 7973
        k = k Xor (version * 4096&)
        For j = 0 To 17                                                             ' layout version information
            mat(j \ 3, s + j Mod 3 - 11) = k And 1 Xor 2
            mat(s + j Mod 3 - 11, j \ 3) = k And 1 Xor 2
            k = k \ 2
        Next
    End If

    ReDim qr(178, 178) As Integer
    For Y = 0 To s - 1
        For X = 0 To s - 1
             qr(Y + 1, X + 1) = getPattern(X, Y, m, version)
        Next X
    Next Y

    
    Sheet.Cells(3, 2).Resize(UBound(qr), UBound(qr)) = qr
    Sheet.Cells(3, 2).Resize(s + 2, s + 2).CopyPicture
   ' n = Sheet.Cells(3, 2).Resize(, s + 2).Width
   ' For j = 1 To 8
   '   txt = Replace(txt, Mid("\/:?*<>|", j, 1), "_")
   ' Next
   ' txt = Replace(txt, Chr(34), "")
   ' c00 = ThisWorkbook.Path & "\QR_" & txt & ".gif"
   
   
  ''''''''''''''''''''''''''''' بارکد براي شيت غير استاندارد
    ThisWorkbook.Activate
    Sheet1.Activate
    ThisWorkbook.Sheets("صدور").Paste Destination:=ThisWorkbook.Sheets("صدور").Range("f7"): Selection.Name = "qrpic0"
    Dim wws As Worksheet
    Dim shpe As Shape
    Set wws = ThisWorkbook.Sheets("صدور")
    Set shpe = wws.Shapes("qrpic0")
    With shpe
    .LockAspectRatio = msoTrue
    .Width = Sheet8.Range("T7").Value
    End With
  ''''''''''''''''''''''''''''' بارکد براي شيت بدون لوگو
    ThisWorkbook.Activate
    Sheet5.Activate
    ThisWorkbook.Sheets("بدون لوگو").Paste Destination:=ThisWorkbook.Sheets("بدون لوگو").Range("F7"): Selection.Name = "qrpic1"
    Dim ws As Worksheet
    Dim shp As Shape
    Set ws = ThisWorkbook.Sheets("بدون لوگو")
    Set shp = ws.Shapes("qrpic1")
    With shp
    .LockAspectRatio = msoTrue
    .Width = Sheet8.Range("T3").Value
    End With
   ''''''''''''''''''''''''''''' بارکد براي شيت لوگو دار
   ThisWorkbook.Activate
   Sheet14.Activate
   ThisWorkbook.Sheets("لوگو دار").Paste Destination:=ThisWorkbook.Sheets("لوگو دار").Range("F9"): Selection.Name = "qrpic2"
    Dim wss As Worksheet
    Dim shap As Shape
    Set wss = ThisWorkbook.Sheets("لوگو دار")
    Set shap = wss.Shapes("qrpic2")
    With shap
    .LockAspectRatio = msoTrue
    .Width = Sheet8.Range("T5").Value
    End With
    
    Sheet1.Activate
    
'''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''

 If CheckBox1 = True Then
 If Sheet1.Shapes("standard").Visible = FULSE And Sheet1.Shapes("SHAPE 5").Visible = True And Sheet1.Shapes("SHAPE 4").Visible = FULSE And Sheet1.Shapes("SHAPE 3").Visible = True And Sheet1.Shapes("SHAPE 3").Visible = True And Sheet1.Cells(2, 2) = "" Then
  Sheet5.PrintPreview
 Else
  MsgBox "شما در حال چاپ ليبل استاندارد در حالت لوگودار هستيد" & vbNewLine & vbNewLine & "دقت نماييد که اين نوع ليبل روتين نميباشد"
  Sheet14.PrintPreview
 End If
Else
 If Sheet1.Shapes("standard").Visible = FULSE And Sheet1.Shapes("SHAPE 5").Visible = True And Sheet1.Shapes("SHAPE 4").Visible = FULSE And Sheet1.Shapes("SHAPE 3").Visible = True And Sheet1.Shapes("SHAPE 3").Visible = True And Sheet1.Cells(2, 2) = "" Then
  Sheet5.PrintPreview
 Else
  Sheet5.PrintPreview
 End If
End If

EEN:
Sheet1.Cells(1, 1) = ""

EN:
End Sub
Private Sub CommandButton2_Click() 'مشخصات
On Error Resume Next
Sheet1.Shapes("qrpic0").Delete
On Error Resume Next
Sheet5.Shapes("qrpic1").Delete
On Error Resume Next
Sheet14.Shapes("qrpic2").Delete

Sheet1.Cells(10, 3) = ""
Sheet1.Cells(3, 13) = 0
Sheet1.Cells(3, 18) = 0
Sheet1.Cells(3, 22) = 0
Sheet1.Cells(3, 24) = 0
Sheet1.Cells(3, 12) = 0
Sheet1.Cells(3, 17) = 0
Sheet1.Cells(3, 21) = 0
Sheet1.Cells(3, 23) = 0
Sheet1.Cells(3, 14) = 0
Sheet1.Cells(3, 16) = 0
Sheet1.Cells(3, 19) = 0
Sheet1.Cells(3, 20) = 0
Sheet1.Cells(3, 25) = 0

If Not IsError(Sheet1.Cells(16, 2)) Then
GoTo ST
End If

D = Left(Sheet1.Cells(4, 6), 1)
a = Len(Sheet1.Cells(4, 6))
If D = "Z" Or D = "z" Then
 a = a - 1
End If
e = Right(Sheet1.Cells(4, 6), a)
Sheet1.Cells(1, 1) = e

For X = 1 To 9999 'جستجوي اطلاعات وزن کيفي
 If Sheet1.Cells(1, 1) = Sheet6.Cells(X, 1) Then
  Sheet1.Cells(3, 25) = Sheet6.Cells(X, 4)
  Exit For
 End If
Next

For X = 1 To 9999 'جستجوي اطلاعات سيم و کابل
 If Sheet1.Cells(4, 3) = Sheet9.Cells(X, 1) And Sheet9.Cells(X, 2) <> "" And Sheet9.Cells(X, 3) <> "" Then
  Sheet1.Cells(3, 12) = Sheet9.Cells(X, 8)
  Sheet1.Cells(3, 17) = Sheet9.Cells(X, 4)
  Sheet1.Cells(3, 21) = Sheet9.Cells(X, 5)
  Sheet1.Cells(3, 23) = Sheet9.Cells(X, 6)
  Exit For
 End If
 
 If Sheet1.Cells(4, 3) = Sheet9.Cells(X, 10) And Sheet9.Cells(X, 11) <> "" And Sheet9.Cells(X, 12) <> "" Then
  Sheet1.Cells(3, 13) = Sheet9.Cells(X, 19)
  Sheet1.Cells(3, 18) = Sheet9.Cells(X, 13)
  Sheet1.Cells(3, 22) = Sheet9.Cells(X, 14)
  Sheet1.Cells(3, 24) = Sheet9.Cells(X, 15)
  Exit For
 End If
 
 D = Right(Sheet1.Cells(4, 3), 1)
 If X = 9999 And D <> "A" And D <> "B" And D <> "C" And D <> "D" And D <> "E" And D <> "F" And D <> "G" And D <> "H" And D <> "I" And D <> "J" And D <> "K" Then
  If MsgBox("بانک اطلاعات سيم و کابل نياز به بروز  رساني دارد" & vbNewLine & vbNewLine & "آيا ادامه ميدهيد ؟", vbYesNo) = vbYes Then
   GoTo refreshh
  Else
   Exit For
  End If
 End If
Next

If Sheet1.Cells(4, 6) = "-" Then
 Sheet1.Cells(4, 6) = ""
End If

ST:

For i = 2 To 9999
If Sheet2.Cells(i, 1) = "" And Sheet2.Cells(i, 2) = "" Then
i = i - 2
Sheet1.Cells(3, 6) = i
Exit For
End If
Next

Sheet1.Cells(3, 7) = "LAB"
'Sheet1.Cells(4, 5) = ": کد محصول"
'Sheet1.Cells(4, 2) = "سريال توليد :"
'Sheet1.Cells(5, 2) = "نوع محصول :"
'Sheet1.Cells(6, 2) = "سايز :"
'Sheet1.Cells(7, 2) = "طول  :"
'Sheet1.Cells(8, 2) = "وزن ( 0.05±) :"
'Sheet1.Cells(9, 4) = "رنگ :"
'Sheet1.Cells(8, 5) = "توضيحات :"
'Sheet1.Cells(8, 3) = "kg"
'Sheet1.Cells(7, 3) = "m"
'Sheet1.Cells(12, 3) = "" 'بسته بند
'Sheet1.Cells(12, 6) = "" 'صادر کننده

Sheet1.Cells(9, 4) = "" 'رنگ
Sheet1.Cells(10, 3) = "" 'توضيحات
Sheet1.Cells(7, 4) = "" 'طول
Sheet1.Cells(8, 4) = "" 'وزن
Sheet1.Cells(5, 3) = "" 'نوع محصول
Sheet1.Cells(6, 3) = "" 'سايز

If Sheet1.Cells(4, 3) = "" Then
GoTo q:
End If

'''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''
If Sheet1.Cells(3, 12) = "0" Then
 Sheet1.Cells(9, 4) = Sheet1.Cells(3, 13)
End If

If Sheet1.Cells(3, 13) = "0" Then
 Sheet1.Cells(9, 4) = Sheet1.Cells(3, 12)
End If

If Sheet1.Cells(3, 12) = 0 And Sheet1.Cells(3, 13) = 0 Then
Sheet1.Cells(9, 4) = ""
End If
'''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''
QQQQ:

e = Left(Sheet1.Cells(4, 6), 1)
If e = "Z" Or e = "z" Then
 a = Len(Sheet1.Cells(4, 6))
 a = a - 1
 Sheet1.Cells(1, 1) = Right(Sheet1.Cells(4, 6), a)
End If

e = Left(Sheet1.Cells(4, 3), 1)
If e <> "B" And e <> "D" Then
 GoTo q
End If

If Sheet1.Cells(3, 17) = 0 Then 'کد کالا از روي سريال توليد
 If Sheet1.Cells(4, 6) = "" Then
  Sheet1.Cells(4, 6) = Sheet1.Cells(3, 18)
 End If
 If Sheet1.Cells(4, 6) <> "" And Sheet1.Cells(4, 6) <> Sheet1.Cells(3, 18) And Sheet1.Cells(4, 6) <> "-" And Sheet1.Cells(1, 1) <> Sheet1.Cells(3, 18) Then
  If MsgBox("کد کالاي وارد شده با سريال توليد مغايرت دارد" & vbNewLine & vbNewLine & "آيا ميخواهيد کد کالا بر اساس سريال توليد بروز شود ؟", vbYesNo) = vbYes Then
   Sheet1.Cells(4, 6) = ""
   GoTo ST
  End If
 End If
 
 If Sheet1.Cells(4, 6) = "ندارد" Or Sheet1.Cells(4, 6) = "-" Or Sheet1.Cells(4, 6) = "_" Or Sheet1.Cells(4, 6) = "" Or Sheet1.Cells(4, 6) = "0" Then
  MsgBox "براي اين شماره سريال در فايل مشخصات توليد   ،  کد کالايي ثبت نشده است" & vbNewLine & vbNewLine & "لطفا صحت نام و کد کالاي استخراج شده را بررسي نمايد"
  Sheet1.Cells(4, 6) = "-"
  Sheet1.Cells(5, 3) = Sheet1.Cells(3, 22)
  Sheet1.Cells(6, 3) = Sheet1.Cells(3, 24)
  
 End If
                     
End If


If Sheet1.Cells(3, 18) = 0 Then 'کد کالا از روي سريال توليد
 If Sheet1.Cells(4, 6) = "" Then
  Sheet1.Cells(4, 6) = Sheet1.Cells(3, 17)
 End If
 If Sheet1.Cells(4, 6) <> "" And Sheet1.Cells(4, 6) <> Sheet1.Cells(3, 17) And Sheet1.Cells(4, 6) <> "-" And Sheet1.Cells(1, 1) <> Sheet1.Cells(3, 17) Then
  If MsgBox("کد کالاي وارد شده با سريال توليد مغايرت دارد" & vbNewLine & vbNewLine & "آيا ميخواهيد کد کالا بر اساس سريال توليد بروز شود ؟", vbYesNo) = vbYes Then
   Sheet1.Cells(4, 6) = ""
   GoTo ST
  End If
 End If
 
 If Sheet1.Cells(4, 6) = "ندارد" Or Sheet1.Cells(4, 6) = "-" Or Sheet1.Cells(4, 6) = "_" Or Sheet1.Cells(4, 6) = "" Or Sheet1.Cells(4, 6) = "0" Then
  MsgBox "براي اين شماره سريال در فايل مشخصات توليد   ،  کد کالايي ثبت نشده است" & vbNewLine & vbNewLine & "لطفا صحت نام و کد کالاي استخراج شده را بررسي نمايد"
  Sheet1.Cells(4, 6) = "-"
  Sheet1.Cells(5, 3) = Sheet1.Cells(3, 21)
  Sheet1.Cells(6, 3) = Sheet1.Cells(3, 23)
  
 End If
 
End If
'''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''
q:

D = Left(Sheet1.Cells(4, 6), 1)

If D <> "Z" And D <> "z" Then
For X = 1 To 9999 'جستجوي کالا در ديتابيس
 If Sheet1.Cells(4, 6) = Sheet6.Cells(X, 1) Then
  Sheet1.Cells(3, 14) = Sheet6.Cells(X, 8)
  Sheet1.Cells(3, 16) = Sheet6.Cells(X, 7)
  Sheet1.Cells(3, 19) = Sheet6.Cells(X, 3)
  Sheet1.Cells(3, 20) = Sheet6.Cells(X, 2)
  Sheet1.Cells(3, 26) = Sheet6.Cells(X, 10)
  Exit For
 End If
 If X = 9999 And Sheet1.Cells(4, 6) <> "-" Then
  MsgBox "کالا در ديتابيس يافت نشد"
 End If
Next
End If

If Sheet1.Cells(3, 14) <> "استاندارد" Then 'قالب بندي استاندارد/غير استاندارد
 Sheet1.Shapes("standard").Visible = FULSE
 Sheet1.Shapes("SHAPE 5").Visible = True
 Sheet1.Shapes("SHAPE 4").Visible = FULSE
 Sheet1.Shapes("SHAPE 3").Visible = True
 Sheet1.Cells(2, 2) = ""
 Sheet1.Cells(3, 2) = ""
 Sheet5.Cells(1, 2).Interior.ColorIndex = 0 ' no fiel
Else
 Sheet1.Shapes("standard").Visible = True
 Sheet1.Cells(3, 2) = "سامانه استعلام پيامکي استاندارد (10001517)"
 Sheet1.Shapes("SHAPE 5").Visible = FULSE
 Sheet1.Shapes("SHAPE 4").Visible = True
 Sheet1.Shapes("SHAPE 3").Visible = FULSE
 Sheet1.Cells(2, 2) = Sheet1.Cells(3, 16)
 Sheet5.Cells(1, 2).Interior.ColorIndex = 1 ' no fiel
End If
QQ:

e = Left(Sheet1.Cells(4, 6), 1)
If e = "Z" Or e = "z" Then
a = Len(Sheet1.Cells(4, 6))
a = a - 1
e = Right(Sheet1.Cells(4, 6), a)
Sheet1.Cells(1, 1) = e
End If

For j = 2 To 1000

If Sheet1.Cells(4, 6) <> "-" Then
If Sheet1.Cells(4, 6) = Sheet6.Cells(j, 1) Or Sheet1.Cells(1, 1) = Sheet6.Cells(j, 1) Then
 Sheet1.Cells(1, 1) = ""
 Sheet1.Cells(6, 3) = Sheet6.Cells(j, 2) 'سايز
 Sheet1.Cells(5, 3) = Sheet6.Cells(j, 3) 'نام کالا
 
 D = Left(Sheet1.Cells(4, 6), 1)
 If D = "Z" Or D = "z" Then
  a = Left(Sheet1.Cells(5, 3), 3)
  c = "س"
  D = "ک"
  
  If InStr(1, a, c, vbTextCompare) > 0 Then 'براي سيم
   b = Len(Sheet1.Cells(5, 3))
   b = b - 3
   a = Right(Sheet1.Cells(5, 3), b)
   Sheet1.Cells(5, 3) = "زيري" & a
   Sheet1.Cells(10, 3) = "زيري"
  Else
   Sheet1.Cells(10, 3) = "مصرف داخلي"
  End If
   
  If InStr(1, a, D, vbTextCompare) > 0 Then 'براي کابل
   b = Len(Sheet1.Cells(5, 3))
   b = b - 0
   a = Right(Sheet1.Cells(5, 3), b)
   Sheet1.Cells(5, 3) = "کالاي نيمه آماده جهت" & " " & a
   Sheet1.Cells(10, 3) = "کالاي نيمه آماده"
  Else
   Sheet1.Cells(10, 3) = "مصرف داخلي"
  End If
 End If

If Sheet1.Cells(3, 17) = 0 And Sheet1.Cells(3, 18) = 0 And Sheet1.Cells(4, 6) = "" Then
 Sheet1.Cells(6, 3) = ""
 Sheet1.Cells(5, 3) = ""
End If

If Sheet1.Cells(3, 17) = 0 And Sheet1.Cells(3, 18) = 0 Then
 GoTo EN
End If

GoTo EN
End If
End If
Next j
GoTo EN
''''''''''''''''''''''''''''''''''''''' بروز رساني اطلاعات ''''''''''''''''''''''''''
refreshh:
Y = Sheet1.Cells(8, 9)
a = Sheet1.Cells(2, 9) & "\" & Y
Dim SIMCABLE As Workbook
Application.DisplayAlerts = False
On Error GoTo ERR
Set SIMCABLE = Workbooks.Open(a, ReadOnly:=True)
Z = Sheet1.Cells(3, 9) 'اکستورد سيم/زيري
SIMCABLE.Worksheets(Z).Range("A3:H9999").Copy 'کپي اطلاعات کالا ها
Sheet9.Range("A1:H9999").PasteSpecial Paste:=xlPasteValues 'xlAll
Z = Sheet1.Cells(4, 9) 'اکسترود روکش
SIMCABLE.Worksheets(Z).Range("A3:J9999").Copy 'کپي اطلاعات کالا ها
Sheet9.Range("J1:S9999").PasteSpecial Paste:=xlPasteValues 'xlAll
SIMCABLE.Close False
Application.DisplayAlerts = True
Sheet1.Activate
b = Sheet1.Cells(5, 9) & "\" & "Database.xlsm"
Dim DATABASE As Workbook
Application.DisplayAlerts = False
On Error GoTo ERR2
Set DATABASE = Workbooks.Open(b, ReadOnly:=True)
Z = Sheet1.Cells(6, 9)
DATABASE.Worksheets(Z).Range("A2:E9999").Copy 'کپي اطلاعات کالا ها
Sheet6.Range("A2:E9999").PasteSpecial xlAll
DATABASE.Worksheets(Z).Range("G2:G9999").Copy 'کپي اطلاعات کالا ها
Sheet6.Range("F2:F9999").PasteSpecial xlAll
DATABASE.Worksheets(Z).Range("F2:F9999").Copy 'کپي اطلاعات کالا ها
Sheet6.Range("G2:G9999").PasteSpecial xlAll
DATABASE.Worksheets(Z).Range("H2:H9999").Copy 'کپي اطلاعات کالا ها
Sheet6.Range("H2:H9999").PasteSpecial xlAll
Z = Sheet1.Cells(7, 9)
DATABASE.Worksheets(Z).Range("A2:B22").Copy 'کپي اطلاعات کالا ها
Sheet8.Range("A2:B22").PasteSpecial xlAll
DATABASE.Close False
Application.DisplayAlerts = True
Sheet1.Activate
MsgBox "اطلاعات بروز رساني شد . جهت اعمال تغييرات ، مجدد دکمه مشخصات را بفشاريد"
GoTo EN
ERR:
MsgBox "فايل سيم و کابل يافت نشد"
GoTo EN
ERR2:
MsgBox "فايل ديتابيس يافت نشد "


''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''
''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''
''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''
EN:
End Sub

Private Sub CommandButton3_Click() ' بروز رساني وزن طرح کيفي

Dim wb As Workbook
Y = Sheet1.Cells(11, 9)
a = Sheet1.Cells(9, 9) & "\" & Y

Application.DisplayAlerts = False
Workbooks(b).Save

'On Error Resume Next
On Error GoTo ERR1
Set wb = Workbooks.Open(a)
On Error GoTo 0

'On Error GoTo ERR2
'wb.Save

If wb Is Nothing Then
    Set wb = Workbooks.Open(a)
'Else: MSGBOX "فايل از قبل باز بوده است"
End If
    
Application.Run "'" & a & "'!weightsub"
wb.Save
'wb.Close
GoTo ENDP

ERR1:
MsgBox "در باز شدن فايل خطا رخ داد"

ERR2:
MsgBox "فايل در حالت فقط خواندني باز شده است و تغييرات ذخيره نميشود"


ENDP:
End Sub
Private Sub CommandButton4_Click() 'تبديل به غير استاندارد
 Sheet1.Shapes("standard").Visible = FULSE
 Sheet1.Shapes("SHAPE 5").Visible = True
 Sheet1.Shapes("SHAPE 4").Visible = FULSE
 Sheet1.Shapes("SHAPE 3").Visible = True
 Sheet1.Cells(2, 2) = ""
 Sheet1.Cells(3, 2) = ""
 Sheet5.Cells(1, 2).Interior.ColorIndex = 0 ' no fiel
End Sub
Private Sub CommandButton5_Click() 'تبديل به استاندارد
 If Sheet1.Cells(2, 2) = "" Then
  MsgBox "اخطار مهم !!!  شما در حال تغيير کالاي بدون استاندارد به قالب استاندارد  ميباشيد"
  Sheet1.Cells(2, 2) = InputBox("کد استاندارد 10 رقمي را وارد نماييد")
  Sheet1.Shapes("standard").Visible = True
  Sheet1.Cells(3, 2) = "سامانه استعلام پيامکي استاندارد (10001517)"
  Sheet1.Shapes("SHAPE 5").Visible = FULSE
  Sheet1.Shapes("SHAPE 4").Visible = True
  Sheet1.Shapes("SHAPE 3").Visible = FULSE
  Sheet5.Cells(1, 2).Interior.ColorIndex = 1 ' black
 Else
 If MsgBox("توجه !  کالاي شما استاندارد است و کد 10 رقمي استاندارد دارد" & vbNewLine & vbNewLine & "آيا ميخواهيد کد 10 رقمي را تغيير دهيد", vbYesNo) = vbYes Then
  Sheet1.Cells(2, 2) = InputBox("کد استاندارد 10 رقمي را وارد نماييد")
  Sheet1.Shapes("standard").Visible = True
  Sheet1.Cells(3, 2) = "سامانه استعلام پيامکي استاندارد (10001517)"
  Sheet1.Shapes("SHAPE 5").Visible = FULSE
  Sheet1.Shapes("SHAPE 4").Visible = True
  Sheet1.Shapes("SHAPE 3").Visible = FULSE
  Sheet5.Cells(1, 2).Interior.ColorIndex = 1 ' black
  End If
End If

If Sheet1.Cells(2, 2) = "" Then
 Sheet1.Shapes("standard").Visible = FULSE
 Sheet1.Cells(3, 2) = ""
 Sheet1.Shapes("SHAPE 5").Visible = True
 Sheet1.Shapes("SHAPE 4").Visible = FULSE
 Sheet1.Shapes("SHAPE 3").Visible = True
 Sheet5.Cells(1, 2).Interior.ColorIndex = 0 ' no fiel
End If

EEEN:
End Sub
Private Sub CommandButton11_Click() 'تنظيم ادرس پلاک کابل
Z = Sheet1.Cells(11, 9)
a = Sheet1.Cells(9, 9) & "\" & Z

ADDD = InputBox("                                                       آدرس فعلي محل فايل" & vbNewLine & vbNewLine & a & vbNewLine & vbNewLine & vbNewLine & "آدرس جديد را وارد نماييد")
 If ADDD = "" Then
   GoTo EN
 End If
 Sheet1.Cells(9, 9) = ADDD
 
a = Sheet1.Cells(9, 9) & "\" & Z
 
Dim pelak As Workbook
Application.DisplayAlerts = False
On Error GoTo ERR
Set pelak = Workbooks.Open(a, ReadOnly:=True)
pelak.Close False
Application.DisplayAlerts = True
GoTo EN
 
ERR:
MsgBox "ادرس وارد شده صحيح نميباشد"
EN:
End Sub
Private Sub CommandButton7_Click() 'تنظيم ادرس توليد سيم و کابل
Z = Sheet1.Cells(8, 9)
a = Sheet1.Cells(2, 9) & "\" & Z

ADDD = InputBox("                                                       آدرس فعلي محل فايل" & vbNewLine & vbNewLine & a & vbNewLine & vbNewLine & vbNewLine & "آدرس جديد را وارد نماييد")
 If ADDD = "" Then
   GoTo EN
 End If
 Sheet1.Cells(2, 9) = ADDD
 
a = Sheet1.Cells(2, 9) & "\" & Z
 
Dim simkabl As Workbook
Application.DisplayAlerts = False
On Error GoTo ERR
Set simkabl = Workbooks.Open(a, ReadOnly:=True)
simkabl.Close False
Application.DisplayAlerts = True
GoTo EN
 
ERR:
MsgBox "ادرس وارد شده صحيح نميباشد"
EN:
End Sub
Private Sub FG1234_Click() 'تنظيم ادرس ديتابيس
b = Sheet1.Cells(5, 9) & "\" & "Database.xlsm"

ADDD = InputBox("                                                        آدرس فعلي محل فايل" & vbNewLine & vbNewLine & b & vbNewLine & vbNewLine & vbNewLine & "آدرس جديد را وارد نماييد")
 If ADDD = "" Then
    GoTo EN
 End If
 Sheet1.Cells(5, 9) = ADDD
 b = Sheet1.Cells(5, 9) & "\" & "Database.xlsm"
 
Dim DATABASE As Workbook
Application.DisplayAlerts = False
On Error GoTo ERR
Set DATABASE = Workbooks.Open(b, ReadOnly:=True)
DATABASE.Close False
Application.DisplayAlerts = True
GoTo EN
 
ERR:
MsgBox "ادرس وارد شده صحيح نميباشد"

EN:
End Sub
Private Sub CommandButton8_Click() 'بروز رساني اطلاعات
'''''''''''''''''''''''''''''''' پلاک کابل ''''''''''''''''''''''''''''''''''''''''''''''
Y = Sheet1.Cells(11, 9)
a = Sheet1.Cells(9, 9) & "\" & Y

Dim pelak As Workbook
Application.DisplayAlerts = False
On Error GoTo ERR3
Set pelak = Workbooks.Open(a, ReadOnly:=True)
 
Z = Sheet1.Cells(10, 9) 'محصولات (انحراف از وزن کيفي)
pelak.Worksheets(Z).Range("H2:H9999").Copy 'کپي اطلاعات کالا ها
Sheet6.Range("I2:I9999").PasteSpecial Paste:=xlPasteValues 'xlAll

pelak.Close False
Application.DisplayAlerts = True
Sheet1.Activate


'''''''''''''''''''''''''''''''' توليد سيم و کابل ''''''''''''''''''''''''''''''''''''''
Y = Sheet1.Cells(8, 9)
a = Sheet1.Cells(2, 9) & "\" & Y
Dim SIMCABLE As Workbook
Application.DisplayAlerts = False
On Error GoTo ERR1
Set SIMCABLE = Workbooks.Open(a, ReadOnly:=True)
 
Z = Sheet1.Cells(3, 9) 'اکستورد سيم/زيري
SIMCABLE.Worksheets(Z).Range("A3:H9999").Copy 'کپي اطلاعات کالا ها
Sheet9.Range("A1:H9999").PasteSpecial Paste:=xlPasteValues 'xlAll

Z = Sheet1.Cells(4, 9) 'اکسترود روکش
SIMCABLE.Worksheets(Z).Range("A3:J9999").Copy 'کپي اطلاعات کالا ها
Sheet9.Range("J1:S9999").PasteSpecial Paste:=xlPasteValues 'xlAll
 
SIMCABLE.Close False
Application.DisplayAlerts = True
Sheet1.Activate
'''''''''''''''''''''''''''''''' ديتابيس ''''''''''''''''''''''''''''''''''''''
b = Sheet1.Cells(5, 9) & "\" & "Database.xlsm"
Dim DATABASE As Workbook
Application.DisplayAlerts = False
On Error GoTo ERR2
Set DATABASE = Workbooks.Open(b, ReadOnly:=True)

Z = Sheet1.Cells(6, 9)

DATABASE.Worksheets(Z).Range("A2:E9999").Copy 'کپي اطلاعات کالا ها
Sheet6.Range("A2:E9999").PasteSpecial xlAll

DATABASE.Worksheets(Z).Range("G2:G9999").Copy 'کپي اطلاعات کالا ها
Sheet6.Range("F2:F9999").PasteSpecial xlAll

DATABASE.Worksheets(Z).Range("F2:F9999").Copy 'کپي اطلاعات کالا ها
Sheet6.Range("G2:G9999").PasteSpecial xlAll

DATABASE.Worksheets(Z).Range("H2:H9999").Copy 'کپي اطلاعات کالا ها
Sheet6.Range("H2:H9999").PasteSpecial xlAll
  
DATABASE.Worksheets(Z).Range("K2:K9999").Copy 'کپي اطلاعات کالا ها
Sheet6.Range("J2:J9999").PasteSpecial xlAll

Z = Sheet1.Cells(7, 9)
DATABASE.Worksheets(Z).Range("A2:B22").Copy 'کپي اطلاعات کالا ها
Sheet8.Range("A2:B22").PasteSpecial xlAll
   
DATABASE.Close False
Application.DisplayAlerts = True
Sheet1.Activate

GoTo EN

ERR1:
MsgBox "فايل سيم و کابل يافت نشد"
GoTo EN
ERR2:
MsgBox "فايل ديتابيس يافت نشد "
ERR3:
MsgBox "فايل پلاک کابل يافت نشد "


EN:
End Sub
Private Sub CommandButton10_Click() 'باز کردن سيم و کابل
Z = Sheet1.Cells(8, 9)
a = Sheet1.Cells(5, 9) & "\" & Z
Dim simkabl As Workbook
Application.DisplayAlerts = False
Set simkabl = Workbooks.Open(a, ReadOnly:=True)
End Sub
Private Sub CommandButton9_Click() 'باز کردن ديتابيس
b = Sheet1.Cells(5, 9) & "\" & "Database.xlsm"
Dim DATABASE As Workbook
Application.DisplayAlerts = False
Set DATABASE = Workbooks.Open(b, ReadOnly:=True)
End Sub
Private Sub CommandButton12_Click() 'باز کردن پلاک کابل
Z = Sheet1.Cells(11, 9)
a = Sheet1.Cells(9, 9) & "\" & Z
Dim pelak As Workbook
Application.DisplayAlerts = False
Set pelak = Workbooks.Open(a, ReadOnly:=True)
End Sub
''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''
Function getPattern(ByVal X As Long, ByVal Y As Long, ByVal m As Integer, ByVal version As Integer) As Integer
    Dim i As Integer, j As Long
    i = mat(X, Y)
    If i < 2 Then
        Select Case m
            Case 0: j = (X + Y) And 1
            Case 1: j = Y And 1
            Case 2: j = X Mod 3
            Case 3: j = (X + Y) Mod 3
            Case 4: j = (X \ 3 + Y \ 2) And 1
            Case 5: j = ((X * Y) And 1) + (X * Y) Mod 3
            Case 6: j = (X * Y + (X * Y) Mod 3) And 1
            Case 7: j = (X + Y + (X * Y) Mod 3) And 1
        End Select
        If j = 0 Then i = i Xor 1 ' invert only data according mask
    End If
    
    getPattern = i And 1
End Function
Private Sub UserForm_QueryClose(Cancel As Integer, CloseMode As Integer)
    Application.Visible = True
End Sub

' ==================================================================== LabelQR
' The text the label QR carries.
'
' The QR encoder in CommandButton1_Click works and is untouched. What it encoded
' was the space-joined label line in C1, which the panel can only read as a bare
' product barcode - so it rejected the whole line as a goods code. These
' routines build the CreateGood JSON the panel actually parses.
'
' Nothing here touches the network. A label must print when the panel server is
' down, when its certificate has expired, and when the line has no route out.
'
' The JSON is pure ASCII: every non-ASCII character is written as a \uXXXX
' escape. This matters because the encoder turns text into bytes with Asc(),
' which is the ANSI code page of whichever Windows the operator runs - CP1256 on
' a Persian install - and the scanner would then have to be set to the matching
' page for the name to survive. Escapes sidestep the code page entirely: the
' symbol carries only bytes 0x20-0x7E, every scanner reads them identically, and
' JSON.parse turns them back into Persian.

Public Function LabelPayloadJson() As String
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets(LQ_SHEET)

    Dim code As String, serial As String, goodName As String, lengthValue As String
    code = LQ_ToLatinDigits(LQ_CleanCell(ws.Range(LQ_CELL_CODE).Value))
    serial = LQ_ToLatinDigits(LQ_CleanCell(ws.Range(LQ_CELL_SERIAL).Value))
    goodName = LQ_JoinCells(ws, LQ_CELLS_NAME)
    lengthValue = LQ_ToLatinDigits(LQ_CleanCell(ws.Range(LQ_CELL_LENGTH).Value))

    Dim out As String
    out = "{"
    out = out & """mode"":" & LQ_JsonString(LQ_MODE) & ","
    out = out & """code"":" & LQ_JsonString(code) & ","
    out = out & """name"":" & LQ_JsonString(goodName) & ","
    out = out & """serial"":" & LQ_JsonString(serial)

    ' A number, not a string: Orash's lengthValue is a decimal. An empty or
    ' non-numeric cell is left out entirely rather than sent as 0.
    If LQ_IsNumericText(lengthValue) Then
        out = out & ",""lengthValue"":" & lengthValue
    End If

    out = out & "}"

    LabelPayloadJson = out
End Function

' Is this text a plain decimal number we can write into JSON unquoted?
Private Function LQ_IsNumericText(ByVal text As String) As Boolean
    Dim i As Long, ch As String, dots As Long
    If Len(text) = 0 Then Exit Function
    For i = 1 To Len(text)
        ch = Mid$(text, i, 1)
        If ch = "." Then
            dots = dots + 1
            If dots > 1 Then Exit Function
        ElseIf ch < "0" Or ch > "9" Then
            Exit Function
        End If
    Next i
    LQ_IsNumericText = True
End Function

' A JSON string literal, ASCII only.
Private Function LQ_JsonString(ByVal text As String) As String
    Dim i As Long, ch As String, cp As Long, out As String
    out = """"
    For i = 1 To Len(text)
        ch = Mid$(text, i, 1)
        cp = AscW(ch)
        If cp < 0 Then cp = cp + 65536
        Select Case cp
            Case 34: out = out & "\"""
            Case 92: out = out & "\\"
            Case 8: out = out & "\b"
            Case 9: out = out & "\t"
            Case 10: out = out & "\n"
            Case 12: out = out & "\f"
            Case 13: out = out & "\r"
            Case 32 To 126: out = out & ch
            Case Else: out = out & "\u" & Right$("000" & Hex$(cp), 4)
        End Select
    Next i
    LQ_JsonString = out & """"
End Function

' Persian and Arabic-Indic digits, so a code typed in either form scans as the
' Latin digits the service expects.
Private Function LQ_ToLatinDigits(ByVal text As String) As String
    Dim i As Long, cp As Long, out As String
    For i = 1 To Len(text)
        cp = AscW(Mid$(text, i, 1))
        If cp < 0 Then cp = cp + 65536
        If cp >= &H6F0 And cp <= &H6F9 Then
            out = out & Chr$(48 + cp - &H6F0)
        ElseIf cp >= &H660 And cp <= &H669 Then
            out = out & Chr$(48 + cp - &H660)
        Else
            out = out & Mid$(text, i, 1)
        End If
    Next i
    LQ_ToLatinDigits = out
End Function

Private Function LQ_CleanCell(ByVal v As Variant) As String
    If IsError(v) Then
        LQ_CleanCell = ""
    Else
        LQ_CleanCell = Application.WorksheetFunction.Trim(CStr(v))
    End If
End Function

' The name spans several cells; empty ones must not leave a stray separator.
Private Function LQ_JoinCells(ByVal ws As Worksheet, ByVal refs As String) As String
    Dim parts() As String, i As Long, piece As String, out As String
    parts = Split(refs, ",")
    For i = LBound(parts) To UBound(parts)
        piece = LQ_CleanCell(ws.Range(Trim$(parts(i))).Value)
        If Len(piece) > 0 Then
            If Len(out) > 0 Then out = out & LQ_SEPARATOR
            out = out & piece
        End If
    Next i
    LQ_JoinCells = out
End Function

/**
 * pm2 process definition.
 *
 *   pm2 start ecosystem.config.js
 *
 * The service reads .env itself (lib/env.js), so pm2 does not need to inject
 * it — keeping one source of truth for configuration. Anything set here in
 * `env` would override the file, so it is deliberately left empty.
 */
module.exports = {
  apps: [
    {
      name: 'orash-scan',
      script: 'server.js',
      cwd: __dirname,

      // One process. The scan relay keeps pairing sessions in memory, so a
      // second instance would not see sessions created by the first.
      instances: 1,
      exec_mode: 'fork',

      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 2000,
      max_memory_restart: '300M',

      watch: false,
      time: true,
      merge_logs: true,
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
    },
  ],
};

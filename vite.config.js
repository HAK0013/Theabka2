import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const single = process.env.SINGLE === '1';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Sessions for authenticated admin users (with disk persistence)
const sessions = new Set();
const authFilePath = path.resolve(__dirname, 'src/data/admin-auth.json');
const sessionsFilePath = path.resolve(__dirname, 'src/data/admin-sessions.json');

function getStoredSessions() {
  try {
    if (fs.existsSync(sessionsFilePath)) {
      const list = JSON.parse(fs.readFileSync(sessionsFilePath, 'utf8'));
      if (Array.isArray(list)) return new Set(list);
    }
  } catch (e) {
    console.warn('Error reading admin-sessions.json', e);
  }
  return new Set();
}

function saveStoredSessions(set) {
  try {
    fs.writeFileSync(sessionsFilePath, JSON.stringify([...set], null, 2), 'utf8');
  } catch (e) {
    console.warn('Error writing admin-sessions.json', e);
  }
}

function getAdminPassword() {
  try {
    if (fs.existsSync(authFilePath)) {
      const data = JSON.parse(fs.readFileSync(authFilePath, 'utf8'));
      if (data && data.password) return String(data.password).trim();
    }
  } catch (e) {
    console.warn('Error reading admin-auth.json', e);
  }
  return 'admin123';
}

function setAdminPassword(newPwd) {
  const data = {
    password: String(newPwd).trim(),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(authFilePath, JSON.stringify(data, null, 2), 'utf8');
}

function isAuthorized(req) {
  const authHeader = req.headers['authorization'] || req.headers['x-admin-token'];
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (sessions.has(token)) return true;
  const stored = getStoredSessions();
  if (stored.has(token)) {
    sessions.add(token);
    return true;
  }
  if (token === getAdminPassword()) return true;
  return false;
}

function getWeddingData() {
  try {
    const weddingFile = path.resolve(__dirname, 'src/data/wedding.js');
    if (fs.existsSync(weddingFile)) {
      const raw = fs.readFileSync(weddingFile, 'utf8');
      const match = raw.match(/export\s+const\s+wedding\s*=\s*([\s\S]*?);?\s*$/);
      if (match) {
        return JSON.parse(match[1]);
      }
    }
  } catch (e) {}
  return {
    groom: { km: 'ជិន ឡុងហាក់', en: 'Chin Longak' },
    bride: { km: 'ជា សុគន្ធា', en: 'Chea Sokunthea' },
    site: { url: 'http://localhost:5173' },
  };
}

// Fills the link-preview tags (og:title in Khmer, absolute og:image URL).
const linkPreview = {
  name: 'link-preview',
  transformIndexHtml(html) {
    const w = getWeddingData();
    const url = (w.site?.url || '').replace(/\/$/, '') || 'http://localhost:5173';
    const groomKm = w.groom?.km || '';
    const brideKm = w.bride?.km || '';
    const groomEn = w.groom?.en || '';
    const brideEn = w.bride?.en || '';
    const title = `សិរីមង្គលអាពាហ៍ពិពាហ៍ ${groomKm} និង ${brideKm}`;
    const desc = `សូមគោរពអញ្ជើញ · ${groomEn} & ${brideEn} · The Wedding Invitation`;
    return html
      .replaceAll('%OG_TITLE%', esc(title))
      .replaceAll('%OG_DESC%', esc(desc))
      .replaceAll('%OG_IMAGE%', esc(`${url}/og.jpg`))
      .replaceAll('%SITE_URL%', esc(url));
  },
};

// Admin API dev server middleware: reads & writes wedding.js and guests.json
const adminApiPlugin = {
  name: 'admin-api',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url, 'http://localhost');
      // Check auth status
      if (url.pathname === '/api/admin-check-auth' && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ authenticated: isAuthorized(req) }));
        return;
      }

      // Admin Login
      if (url.pathname === '/api/admin-login' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const { password } = JSON.parse(body || '{}');
            const currentPass = getAdminPassword();
            if (password && String(password).trim() === currentPass) {
              const token = 'tok_' + crypto.randomBytes(16).toString('hex');
              sessions.add(token);
              const stored = getStoredSessions();
              stored.add(token);
              saveStoredSessions(stored);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, token }));
            } else {
              res.statusCode = 401;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: 'ពាក្យសម្ងាត់មិនត្រឹមត្រូវ (Incorrect password)' }));
            }
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      // Admin Logout
      if (url.pathname === '/api/admin-logout' && req.method === 'POST') {
        const authHeader = req.headers['authorization'] || req.headers['x-admin-token'];
        if (authHeader) {
          const token = authHeader.replace(/^Bearer\s+/i, '').trim();
          sessions.delete(token);
          const stored = getStoredSessions();
          stored.delete(token);
          saveStoredSessions(stored);
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // Change Password
      if (url.pathname === '/api/admin-change-password' && req.method === 'POST') {
        if (!isAuthorized(req)) {
          res.statusCode = 401;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Unauthorized: Admin authentication required' }));
          return;
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const { currentPassword, newPassword } = JSON.parse(body || '{}');
            const expectedPass = getAdminPassword();
            if (String(currentPassword).trim() !== expectedPass) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'ពាក្យសម្ងាត់ចាស់មិនត្រឹមត្រូវ (Current password incorrect)' }));
              return;
            }
            if (!newPassword || String(newPassword).trim().length < 4) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'ពាក្យសម្ងាត់ថ្មីត្រូវមានយ៉ាងតិច ៤ តួអក្សរ (Min 4 chars)' }));
              return;
            }
            setAdminPassword(newPassword);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, message: 'បានប្តូរពាក្យសម្ងាត់ជោគជ័យ' }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      if (url.pathname === '/api/get-wedding' && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        try {
          let currentWedding = getWeddingData();
          const weddingFile = path.resolve(__dirname, 'src/data/wedding.js');
          if (fs.existsSync(weddingFile)) {
            const raw = fs.readFileSync(weddingFile, 'utf8');
            const match = raw.match(/export\s+const\s+wedding\s*=\s*([\s\S]*?);?\s*$/);
            if (match) {
              try {
                currentWedding = JSON.parse(match[1]);
              } catch (_) {}
            }
          }
          const guestsPath = path.resolve(__dirname, 'src/data/guests.json');
          const guests = fs.existsSync(guestsPath)
            ? JSON.parse(fs.readFileSync(guestsPath, 'utf8'))
            : [];
          const galleryPath = path.resolve(__dirname, 'src/data/gallery.json');
          const gallery = fs.existsSync(galleryPath)
            ? JSON.parse(fs.readFileSync(galleryPath, 'utf8'))
            : [];
          res.end(JSON.stringify({ wedding: currentWedding, guests, gallery }));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e.message }));
        }
        return;
      }

      if (url.pathname === '/api/upload-photo' && req.method === 'POST') {
        if (!isAuthorized(req)) {
          res.statusCode = 401;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Unauthorized: Admin authentication required' }));
          return;
        }
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (!data.data) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'No image data provided' }));
              return;
            }
            const uploadsDir = path.resolve(__dirname, 'public/uploads');
            if (!fs.existsSync(uploadsDir)) {
              fs.mkdirSync(uploadsDir, { recursive: true });
            }

            const rawData = data.data;
            const matches = rawData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            const base64Str = matches ? matches[2] : rawData;
            const mimeSub = matches ? matches[1].split('/')[1] : '';
            const nameExt = data.filename && data.filename.includes('.') ? data.filename.split('.').pop().toLowerCase() : '';
            let cleanExt = (nameExt || (mimeSub === 'jpeg' ? 'jpg' : mimeSub) || 'jpg').replace(/[^a-zA-Z0-9]/g, '');
            if (cleanExt === 'jpeg' || cleanExt === 'mpeg') cleanExt = cleanExt === 'mpeg' ? 'mp3' : 'jpg';

            const originalName = (data.filename || 'upload')
              .replace(/\.[^/.]+$/, '')
              .toLowerCase()
              .replace(/[^a-z0-9_-]/g, '_');
            const uniqueFilename = `${originalName}-${Date.now()}.${cleanExt || 'jpg'}`;
            const targetPath = path.resolve(uploadsDir, uniqueFilename);

            fs.writeFileSync(targetPath, Buffer.from(base64Str, 'base64'));

            const publicUrl = `/uploads/${uniqueFilename}`;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, url: publicUrl, filename: uniqueFilename }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }

      if (url.pathname === '/api/save-wedding' && req.method === 'POST') {
        if (!isAuthorized(req)) {
          res.statusCode = 401;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Unauthorized: Admin authentication required' }));
          return;
        }
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.wedding) {
              const weddingPath = path.resolve(__dirname, 'src/data/wedding.js');
              const fileContent = `// ════════════════════════════════════════════════════════════════════\n//  ព័ត៌មានអាពាហ៍ពិពាហ៍ · WEDDING DETAILS\n//  Every name, date, place and colour on the site comes from this file.\n//  Updated via Admin Panel.\n// ════════════════════════════════════════════════════════════════════\n\nexport const wedding = ${JSON.stringify(data.wedding, null, 2)};\n`;
              fs.writeFileSync(weddingPath, fileContent, 'utf8');
            }
            if (data.guests) {
              const guestsPath = path.resolve(__dirname, 'src/data/guests.json');
              fs.writeFileSync(guestsPath, JSON.stringify(data.guests, null, 2), 'utf8');
            }
            if (data.gallery) {
              const galleryPath = path.resolve(__dirname, 'src/data/gallery.json');
              fs.writeFileSync(galleryPath, JSON.stringify(data.gallery, null, 2), 'utf8');
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }
      next();
    });
  },
};

export default defineConfig({
  // Relative asset paths so the build works under https://<user>.github.io/<repo>/
  base: './',
  server: {
    allowedHosts: true,
    watch: {
      ignored: ['**/src/data/**', '**/public/uploads/**'],
    },
  },
  plugins: [linkPreview, adminApiPlugin, single && viteSingleFile()].filter(Boolean),
  build: single
    ? { outDir: 'dist-single', assetsInlineLimit: 1e9, cssCodeSplit: false }
    : {
        outDir: 'dist',
        rollupOptions: {
          input: {
            main: path.resolve(__dirname, 'index.html'),
            admin: path.resolve(__dirname, 'admin.html'),
          },
        },
      },
});

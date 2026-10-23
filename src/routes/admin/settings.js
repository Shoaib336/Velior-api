// Store-wide settings, saved one section at a time.
import { Router } from 'express';
import { ok, parse } from '../../lib/http.js';
import { loadSettings, saveSettings, settingsPatchSchema } from '../../lib/settings.js';

const router = Router();

router.get('/settings', async (req, res) => {
  ok(res, { settings: await loadSettings() });
});

router.patch('/settings', async (req, res) => {
  await saveSettings(parse(settingsPatchSchema, req.body));
  ok(res, { settings: await loadSettings() }, 'Settings saved');
});

export default router;

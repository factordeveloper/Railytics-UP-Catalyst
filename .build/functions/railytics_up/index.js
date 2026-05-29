'use strict';

const express = require('express');
const path = require('path');
const app = express();

app.use(express.json({ limit: '10mb' }));

// ── Load mock data ──────────────────────────────────────────────
const streamsData = require('./mock-data/streams.json');
const eventsData = require('./mock-data/events.json');
const framesStore = require('./mock-data/frames.json');

// ── In-memory state (simulates running analysis) ────────────────
let analysisActive = false;
let analysisSessions = [];

// ── Helper: generate SVG placeholder image ──────────────────────
function generateTrainFrameSVG(filename, width = 1280, height = 720) {
  const colors = ['#1a472a', '#2d5016', '#1a3a5c', '#4a2d1a', '#3d1a4a', '#1a4a4a'];
  const bgColor = colors[Math.abs(hashCode(filename)) % colors.length];
  const trainColors = ['#FFB000', '#E09900', '#CC8400', '#FFCC33'];
  const tc = trainColors[Math.abs(hashCode(filename + 'tc')) % trainColors.length];

  // Determine stream location from filename
  let location = 'Unknown Location';
  if (filename.includes('folkston')) location = 'Folkston, GA';
  else if (filename.includes('laplata')) location = 'La Plata, MO';
  else if (filename.includes('cajon')) location = 'Cajon Pass, CA';
  else if (filename.includes('rochelle')) location = 'Rochelle, IL';
  else if (filename.includes('tehachapi')) location = 'Tehachapi, CA';
  else if (filename.includes('dalton')) location = 'Dalton, GA';

  const detBoxX = 80 + (Math.abs(hashCode(filename + 'x')) % 200);
  const detBoxY = 100 + (Math.abs(hashCode(filename + 'y')) % 100);
  const detBoxW = 400 + (Math.abs(hashCode(filename + 'w')) % 300);
  const detBoxH = 250 + (Math.abs(hashCode(filename + 'h')) % 150);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="sky" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#87CEEB;stop-opacity:0.3"/>
      <stop offset="60%" style="stop-color:${bgColor};stop-opacity:0.8"/>
      <stop offset="100%" style="stop-color:#1a1a1a;stop-opacity:1"/>
    </linearGradient>
    <linearGradient id="train" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:${tc};stop-opacity:0.9"/>
      <stop offset="100%" style="stop-color:#8B4513;stop-opacity:0.7"/>
    </linearGradient>
  </defs>
  <!-- Background -->
  <rect width="${width}" height="${height}" fill="url(#sky)"/>
  <!-- Ground/tracks -->
  <rect x="0" y="${height - 180}" width="${width}" height="180" fill="#3a3a3a" opacity="0.8"/>
  <rect x="0" y="${height - 140}" width="${width}" height="4" fill="#8a8a8a"/>
  <rect x="0" y="${height - 120}" width="${width}" height="4" fill="#8a8a8a"/>
  <!-- Train body -->
  <rect x="${detBoxX}" y="${detBoxY}" width="${detBoxW}" height="${detBoxH}" rx="8" fill="url(#train)" stroke="${tc}" stroke-width="3"/>
  <!-- Wheels -->
  <circle cx="${detBoxX + 60}" cy="${detBoxY + detBoxH - 10}" r="25" fill="#333" stroke="#666" stroke-width="3"/>
  <circle cx="${detBoxX + detBoxW - 60}" cy="${detBoxY + detBoxH - 10}" r="25" fill="#333" stroke="#666" stroke-width="3"/>
  <!-- Detection bounding box -->
  <rect x="${detBoxX - 10}" y="${detBoxY - 10}" width="${detBoxW + 20}" height="${detBoxH + 20}" fill="none" stroke="#00FF00" stroke-width="3" stroke-dasharray="10,5"/>
  <!-- Detection label -->
  <rect x="${detBoxX - 10}" y="${detBoxY - 40}" width="180" height="28" fill="#00FF00" rx="4"/>
  <text x="${detBoxX}" y="${detBoxY - 18}" font-family="monospace" font-size="16" fill="#000" font-weight="bold">Railcar 0.92</text>
  <!-- Timestamp overlay -->
  <rect x="10" y="10" width="380" height="35" fill="rgba(0,0,0,0.7)" rx="5"/>
  <text x="20" y="32" font-family="monospace" font-size="14" fill="#00FF00">RAILYTICS | ${location} | ${filename}</text>
  <!-- Info overlay -->
  <rect x="10" y="${height - 45}" width="300" height="35" fill="rgba(0,0,0,0.7)" rx="5"/>
  <text x="20" y="${height - 20}" font-family="monospace" font-size="13" fill="#FFC107">YOLO v8 | Conf: 0.92 | Mock Frame</text>
  <!-- Railytics branding -->
  <rect x="${width - 200}" y="10" width="190" height="35" fill="rgba(255,173,1,0.9)" rx="5"/>
  <text x="${width - 190}" y="33" font-family="Arial" font-size="16" fill="#000" font-weight="bold">RAILYTICS CATALYST</text>
</svg>`;
}

function generateCropSVG(text, width = 400, height = 120) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#1f1f1f"/>
  <rect x="5" y="5" width="${width - 10}" height="${height - 10}" fill="none" stroke="#FFC107" stroke-width="2" rx="4"/>
  <text x="${width / 2}" y="${height / 2 + 8}" font-family="monospace" font-size="28" fill="#FFC107" text-anchor="middle" font-weight="bold">${text || 'REPORTING MARK'}</text>
  <text x="${width / 2}" y="${height / 2 + 35}" font-family="monospace" font-size="12" fill="#888" text-anchor="middle">OCR Confidence: 0.87</text>
</svg>`;
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

// ── CORS middleware ──────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ══════════════════════════════════════════════════════════════════
//  STATUS & SYSTEM
// ══════════════════════════════════════════════════════════════════
app.get('/status', (req, res) => {
  res.json({
    active: analysisActive,
    stream_id: analysisSessions.length > 0 ? analysisSessions[0].stream_id : null,
    stream_name: analysisSessions.length > 0 ? analysisSessions[0].stream_name : null,
    frames_processed: 4520,
    trains_detected: 1325,
    frames_discarded: 3195,
    detection_rate: 29.3,
    start_time: analysisActive ? new Date(Date.now() - 3600000).toISOString() : null,
    model_info: {
      model_path: 'yolov8n.pt',
      target_labels: ['Railcar', 'Locomotive', 'Reporting Mark'],
      device: 'cpu (Mock Mode)'
    }
  });
});

app.get('/device/info', (req, res) => {
  res.json({
    device: 'cpu',
    cuda_available: false,
    gpu_name: null,
    platform: 'Zoho Catalyst (Mock)',
    node_version: process.version,
    mode: 'prototype'
  });
});

app.get('/model/info', (req, res) => {
  res.json({
    model_path: 'yolov8n.pt',
    target_labels: ['Railcar', 'Locomotive', 'Reporting Mark'],
    target_class_ids: [0, 1, 2],
    device: 'cpu (Mock)',
    confidence_threshold: 0.5
  });
});

app.get('/system/railcar-types', (req, res) => {
  res.json({
    railcar_types: ['Railcar', 'Locomotive', 'Boxcar', 'Tanker', 'Hopper', 'Flatcar', 'Gondola', 'Intermodal']
  });
});

// ══════════════════════════════════════════════════════════════════
//  STREAMS
// ══════════════════════════════════════════════════════════════════
app.get('/streams', (req, res) => {
  const activeOnly = req.query.active_only === 'true';
  const filtered = activeOnly ? streamsData.filter(s => s.active) : streamsData;
  res.json({ streams: filtered, total: filtered.length });
});

app.get('/streams/:streamId', (req, res) => {
  const stream = streamsData.find(s => s.id === req.params.streamId);
  if (!stream) return res.status(404).json({ detail: 'Stream not found' });
  res.json(stream);
});

app.post('/streams/preview', (req, res) => {
  const { url } = req.body;
  res.json({
    title: 'Mock Stream Preview',
    uploader: 'Virtual Railfan',
    view_count: 1500000,
    is_live: true,
    thumbnail: null,
    url
  });
});

app.post('/streams', (req, res) => {
  const newStream = {
    id: `stream-${Date.now()}`,
    name: req.body.name || 'New Stream',
    url: req.body.url || '',
    description: req.body.description || '',
    active: true,
    thumbnail: null,
    youtube_metadata: { title: req.body.name, uploader: 'User', view_count: 0, is_live: true },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  streamsData.push(newStream);
  res.status(201).json(newStream);
});

app.put('/streams/:streamId', (req, res) => {
  const idx = streamsData.findIndex(s => s.id === req.params.streamId);
  if (idx === -1) return res.status(404).json({ detail: 'Stream not found' });
  Object.assign(streamsData[idx], req.body, { updated_at: new Date().toISOString() });
  res.json(streamsData[idx]);
});

app.delete('/streams/:streamId', (req, res) => {
  const idx = streamsData.findIndex(s => s.id === req.params.streamId);
  if (idx === -1) return res.status(404).json({ detail: 'Stream not found' });
  streamsData.splice(idx, 1);
  res.json({ message: 'Stream deleted' });
});

// ══════════════════════════════════════════════════════════════════
//  FRAMES
// ══════════════════════════════════════════════════════════════════
app.get('/frames', (req, res) => {
  const limit = parseInt(req.query.limit) || 12;
  const skip = parseInt(req.query.skip) || 0;
  const streamId = req.query.stream_id || '';

  let frames = framesStore.frames;
  if (streamId) {
    frames = frames.filter(f => f.stream_id === streamId);
  }

  const total = frames.length;
  const paginated = frames.slice(skip, skip + limit);

  res.json({
    frames: paginated,
    total,
    frames_processed: framesStore.frames_processed,
    frames_discarded: framesStore.frames_discarded,
    limit,
    skip
  });
});

app.delete('/frames', (req, res) => {
  res.json({ message: 'All frames deleted (mock)', deleted_count: framesStore.frames.length });
});

// Serve frame images as generated SVG
app.get('/frame/:filename', (req, res) => {
  const svg = generateTrainFrameSVG(req.params.filename);
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(svg);
});

// Serve cropped reporting mark images
app.get('/frame/:filename/crop', (req, res) => {
  const filename = req.params.filename;
  const frame = framesStore.frames.find(f => f.filename === filename);
  let text = 'REPORTING MARK';
  if (frame) {
    for (const det of frame.detections) {
      if (det.serials && det.serials.length > 0) {
        text = det.serials[0].cleaned_text || det.serials[0].text;
        break;
      }
    }
  }
  const svg = generateCropSVG(text);
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(svg);
});

// Get serials for a frame
app.get('/frame/:filename/serials', (req, res) => {
  const frame = framesStore.frames.find(f => f.filename === req.params.filename);
  if (!frame) return res.status(404).json({ detail: 'Frame not found' });

  const trainsWithSerials = frame.detections
    .filter(d => d.class_name === 'Railcar' || d.class_name === 'Locomotive')
    .map((det, idx) => ({
      train_index: idx + 1,
      train_confidence: det.confidence,
      serial_count: det.serial_count,
      serials: det.serials || []
    }));

  const totalSerials = trainsWithSerials.reduce((sum, t) => sum + t.serial_count, 0);

  res.json({
    filename: req.params.filename,
    total_trains: trainsWithSerials.length,
    total_serials: totalSerials,
    trains_with_serials: trainsWithSerials
  });
});

// ══════════════════════════════════════════════════════════════════
//  DETECTIONS
// ══════════════════════════════════════════════════════════════════
app.get('/detections', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const skip = parseInt(req.query.skip) || 0;

  const detections = [];
  for (const frame of framesStore.frames) {
    for (const det of frame.detections) {
      detections.push({
        filename: frame.filename,
        timestamp: frame.timestamp,
        stream_id: frame.stream_id,
        class_name: det.class_name,
        confidence: det.confidence,
        bbox: det.bbox,
        serials: det.serials || [],
        serial_count: det.serial_count
      });
    }
  }

  const total = detections.length;
  const paginated = detections.slice(skip, skip + limit);

  res.json({ detections: paginated, total, limit, skip });
});

app.get('/serials/stats', (req, res) => {
  const allSerials = [];
  for (const frame of framesStore.frames) {
    for (const det of frame.detections) {
      if (det.serials) {
        for (const s of det.serials) {
          allSerials.push(s.cleaned_text || s.text);
        }
      }
    }
  }

  const unique = [...new Set(allSerials)];
  const counts = {};
  allSerials.forEach(s => { counts[s] = (counts[s] || 0) + 1; });

  res.json({
    total_serials_detected: allSerials.length,
    unique_serials: unique.length,
    serials: unique.map(s => ({ text: s, count: counts[s], first_seen: '2026-02-07T08:12:30Z' })),
    detection_rate: 29.3,
    frames_with_serials: framesStore.frames.filter(f => f.total_serials > 0).length,
    total_frames: framesStore.frames.length
  });
});

// ══════════════════════════════════════════════════════════════════
//  RAILWAY EVENTS
// ══════════════════════════════════════════════════════════════════
app.get('/railway-events', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const skip = parseInt(req.query.skip) || 0;
  const streamId = req.query.stream_id || '';

  let events = [...eventsData].sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
  if (streamId) {
    events = events.filter(e => e.stream_id === streamId);
  }

  const total = events.length;
  const paginated = events.slice(skip, skip + limit);

  res.json({ events: paginated, total, limit, skip });
});

app.get('/railway-events/:eventId', (req, res) => {
  const event = eventsData.find(e => e.id === req.params.eventId);
  if (!event) return res.status(404).json({ detail: 'Event not found' });
  res.json(event);
});

app.get('/railway-events/:eventId/frames', (req, res) => {
  const event = eventsData.find(e => e.id === req.params.eventId);
  if (!event) return res.status(404).json({ detail: 'Event not found' });

  const limit = parseInt(req.query.limit) || 24;
  const skip = parseInt(req.query.skip) || 0;

  // Get frames matching this event's stream
  let eventFrames = framesStore.frames.filter(f => f.stream_id === event.stream_id);
  if (eventFrames.length === 0) eventFrames = framesStore.frames.slice(0, 5);

  const total = eventFrames.length;
  const paginated = eventFrames.slice(skip, skip + limit);

  res.json({
    event,
    frames: paginated,
    total,
    limit,
    skip
  });
});

app.get('/railway-events/:eventId/video', (req, res) => {
  // Return a simple MP4 placeholder - 1x1 pixel video or redirect to a test video
  res.json({
    message: 'Video generation simulated (mock mode)',
    event_id: req.params.eventId,
    video_url: null,
    status: 'mock'
  });
});

app.head('/railway-events/:eventId/video', (req, res) => {
  res.setHeader('Content-Type', 'video/mp4');
  res.sendStatus(200);
});

// ══════════════════════════════════════════════════════════════════
//  ANALYSIS
// ══════════════════════════════════════════════════════════════════
app.post('/analysis/start', (req, res) => {
  const { stream_id, duration_minutes } = req.body;
  const stream = streamsData.find(s => s.id === stream_id);
  if (!stream) return res.status(404).json({ detail: 'Stream not found' });

  // Check if already analyzing this stream
  const existing = analysisSessions.find(s => s.stream_id === stream_id);
  if (existing) return res.json({ message: 'Analysis already running for this stream', session: existing });

  const session = {
    stream_id,
    stream_name: stream.name,
    active: true,
    start_time: new Date().toISOString(),
    duration_minutes: duration_minutes || 0,
    frames_processed: Math.floor(Math.random() * 200) + 50,
    trains_detected: Math.floor(Math.random() * 60) + 10,
    frames_discarded: Math.floor(Math.random() * 150) + 30,
    detection_rate: parseFloat((Math.random() * 30 + 10).toFixed(1)),
    runtime_seconds: 0
  };

  analysisSessions.push(session);
  analysisActive = true;

  // Simulate increasing metrics
  const interval = setInterval(() => {
    const s = analysisSessions.find(ss => ss.stream_id === stream_id);
    if (!s || !s.active) { clearInterval(interval); return; }
    s.frames_processed += Math.floor(Math.random() * 5) + 1;
    s.trains_detected += Math.random() > 0.7 ? 1 : 0;
    s.frames_discarded += Math.floor(Math.random() * 4);
    s.runtime_seconds += 3;
    s.detection_rate = parseFloat(((s.trains_detected / s.frames_processed) * 100).toFixed(1));
  }, 3000);

  res.json({ message: `Analysis started for ${stream.name}`, session });
});

app.post('/analysis/stop', (req, res) => {
  const streamId = req.query.stream_id || req.body?.stream_id;

  if (streamId) {
    const idx = analysisSessions.findIndex(s => s.stream_id === streamId);
    if (idx !== -1) {
      analysisSessions[idx].active = false;
      analysisSessions.splice(idx, 1);
    }
  } else {
    analysisSessions.forEach(s => s.active = false);
    analysisSessions = [];
  }

  analysisActive = analysisSessions.length > 0;
  res.json({ message: 'Analysis stopped', active_sessions: analysisSessions.length });
});

app.get('/analysis/status', (req, res) => {
  if (analysisSessions.length === 0) {
    return res.json({ active: false, stream_id: null, frames_processed: 0, trains_detected: 0, detection_rate: 0 });
  }
  const first = analysisSessions[0];
  res.json({
    active: first.active,
    stream_id: first.stream_id,
    stream_name: first.stream_name,
    frames_processed: first.frames_processed,
    trains_detected: first.trains_detected,
    frames_discarded: first.frames_discarded,
    detection_rate: first.detection_rate,
    start_time: first.start_time
  });
});

app.get('/analysis/sessions', (req, res) => {
  res.json({
    active_sessions: analysisSessions.filter(s => s.active),
    total: analysisSessions.filter(s => s.active).length
  });
});

app.get('/analysis/sessions/:streamId', (req, res) => {
  const session = analysisSessions.find(s => s.stream_id === req.params.streamId);
  if (!session) return res.status(404).json({ detail: 'Session not found' });
  res.json(session);
});

app.post('/analysis/stop/:streamId', (req, res) => {
  const idx = analysisSessions.findIndex(s => s.stream_id === req.params.streamId);
  if (idx !== -1) {
    analysisSessions[idx].active = false;
    analysisSessions.splice(idx, 1);
  }
  analysisActive = analysisSessions.length > 0;
  res.json({ message: 'Stream analysis stopped' });
});

// ══════════════════════════════════════════════════════════════════
//  LEGACY CAPTURE ENDPOINTS
// ══════════════════════════════════════════════════════════════════
app.post('/start-capture', (req, res) => {
  analysisActive = true;
  res.json({ message: 'Capture started (mock)', status: 'running' });
});

app.post('/stop-capture', (req, res) => {
  analysisActive = false;
  res.json({ message: 'Capture stopped (mock)', status: 'stopped' });
});

// ══════════════════════════════════════════════════════════════════
//  NETWORK DIAGNOSTICS
// ══════════════════════════════════════════════════════════════════
app.get('/network/diagnostics', (req, res) => {
  res.json({
    status: 'ok',
    platform: 'Zoho Catalyst',
    mode: 'Mock Prototype',
    connectivity: { youtube: true, database: true, storage: true },
    latency: { api: '12ms', database: '5ms' }
  });
});

// ══════════════════════════════════════════════════════════════════
//  CATCH-ALL & ROOT
// ══════════════════════════════════════════════════════════════════
app.get('/', (req, res) => {
  res.json({
    service: 'Railytics Catalyst API',
    version: '1.0.0-mock',
    mode: 'prototype',
    endpoints: [
      'GET  /status',
      'GET  /streams',
      'GET  /frames',
      'GET  /frame/:filename',
      'GET  /detections',
      'GET  /serials/stats',
      'GET  /railway-events',
      'GET  /railway-events/:id/frames',
      'POST /analysis/start',
      'POST /analysis/stop',
      'GET  /analysis/sessions'
    ]
  });
});

// ── Export for Catalyst ─────────────────────────────────────────
module.exports = app;

// Regenerates tests/fixtures/* (needs ffmpeg). Fixtures are committed, so this only runs when they change.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
mkdirSync(dir, { recursive: true });
const ff = (...args) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { cwd: dir, stdio: 'inherit' });

// 3 s stereo: 440 Hz left, 1 kHz right — known frequencies for the spectrum checks.
ff('-f', 'lavfi', '-i', 'sine=frequency=440:duration=3:sample_rate=44100', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=3:sample_rate=44100',
  '-filter_complex', '[0][1]amerge=inputs=2,volume=0.6', '-ac', '2', 'tone.wav');
ff('-i', 'tone.wav', '-c:a', 'aac', '-b:a', '96k', 'tone.m4a');
ff('-i', 'tone.wav', '-c:a', 'libmp3lame', '-b:a', '96k', 'tone.mp3');
ff('-i', 'tone.wav', '-c:a', 'libopus', '-b:a', '64k', 'tone.ogg');
ff('-i', 'tone.wav', '-c:a', 'flac', 'tone.flac');
// A video file whose sound track should be usable as the audio source.
ff('-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=3', '-i', 'tone.wav', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', 'clip.mp4');
// 16:9, 4 s: red | green | blue thirds (which part a 9:16 crop kept is readable from pixels) + a quiet 330 Hz tone (the sine source is 1/8 full scale)
// (about −30 LUFS, so loudness normalisation must raise it).
ff('-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=30:d=4,drawbox=x=213:y=0:w=214:h=360:color=lime:t=fill,drawbox=x=427:y=0:w=213:h=360:color=blue:t=fill',
  '-f', 'lavfi', '-i', 'sine=frequency=330:duration=4:sample_rate=48000,volume=0.32', '-ac', '2', '-shortest',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', '-c:a', 'aac', '-b:a', '96k', 'wide.mp4');
ff('-f', 'lavfi', '-i', 'testsrc2=size=400x300:duration=1', '-frames:v', '1', '-q:v', '3', 'photo.jpg');
ff('-f', 'lavfi', '-i', 'testsrc2=size=300x200:duration=1', '-frames:v', '1', 'photo.png');
writeFileSync(join(dir, 'notaudio.txt'), 'this is not audio');

/* photo-exif.jpg: photo.jpg + little-endian EXIF (Orientation=6, i.e. rotate 90°) + XMP + COM + trailing junk */
const seg = (marker, payload) => {
  const len = payload.length + 2;
  return Buffer.concat([Buffer.from([0xff, marker, len >> 8, len & 255]), payload]);
};
const tiff = Buffer.alloc(8 + 2 + 2 * 12 + 4 + 64);
tiff.write('II', 0, 'latin1');
tiff.writeUInt16LE(42, 2);
tiff.writeUInt32LE(8, 4);
tiff.writeUInt16LE(2, 8); // 2 entries
// 0x010F Make (ASCII, points to offset 38)
tiff.writeUInt16LE(0x010f, 10); tiff.writeUInt16LE(2, 12); tiff.writeUInt32LE(10, 14); tiff.writeUInt32LE(38, 18);
// 0x0112 Orientation = 6
tiff.writeUInt16LE(0x0112, 22); tiff.writeUInt16LE(3, 24); tiff.writeUInt32LE(1, 26); tiff.writeUInt16LE(6, 30);
tiff.writeUInt32LE(0, 34);
tiff.write('TestCam\0\0\0', 38, 'latin1');
const exif = seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]));
const xmp = seg(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>secret GPS 21.0,105.8</x:xmpmeta>', 'latin1'));
const com = seg(0xfe, Buffer.from('private comment', 'latin1'));
const jpg = readFileSync(join(dir, 'photo.jpg'));
writeFileSync(join(dir, 'photo-exif.jpg'), Buffer.concat([jpg.subarray(0, 2), exif, xmp, com, jpg.subarray(2), Buffer.from('TRAILING-THUMBNAIL-DATA')]));
console.log('fixtures written to', dir);

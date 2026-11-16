// Keyboard and mouse state for the local player: a held-keys set, mouse-look
// deltas accumulated between steps, pointer lock on the canvas. The
// simulation reads and clears the deltas once per fixed step, so look speed
// never depends on the display's refresh rate.
export function createInput(canvas, onLockChange) {
 const keys = new Set();
 const pressed = new Set(); // keys that went down since the last step
 let lookDX = 0, lookDY = 0;
 let firing = false;
 let locked = false;

 window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  pressed.add(e.code);
  if (['Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
 });
 window.addEventListener('keyup', (e) => keys.delete(e.code));
 window.addEventListener('blur', () => { keys.clear(); firing = false; });

 canvas.addEventListener('mousedown', (e) => {
  if (!locked) return;
  if (e.button === 0) firing = true;
  if (e.button === 2) pressed.add('MouseRight');
 });
 window.addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; });
 canvas.addEventListener('contextmenu', (e) => e.preventDefault());

 document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked) firing = false;
  onLockChange(locked);
 });
 document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  lookDX += e.movementX || 0;
  lookDY += e.movementY || 0;
 });

 return {
  get locked() { return locked; },
  get firing() { return firing; },
  down(code) { return keys.has(code); },
  requestLock() {
   // Newer Chrome returns a promise; a refusal (no real gesture, an
   // embedded frame) must never surface as an unhandled rejection.
   try {
    const p = canvas.requestPointerLock();
    if (p && typeof p.catch === 'function') p.catch(() => {});
   } catch { /* the overlay stays up; the next click retries */ }
  },
  // Called once per fixed step by the player controller.
  consumeStep() {
   const step = { dx: lookDX, dy: lookDY };
   lookDX = 0; lookDY = 0;
   pressed.clear();
   return step;
  },
  // Buy-menu and shot modes read single presses without the step clearing
  // them first; main polls this before stepping the player.
  peekPressed() { return pressed; },
 };
}

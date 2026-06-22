/**
 * TransitionScene.js — Balloon Transition Between Scenes
 * =======================================================
 * Animates balloons rising from bottom to top, switching scenes
 * when balloons reach the midpoint. Used between Game -> End.
 *
 * Launch with:
 *   this.scene.launch('TransitionScene', {
 *     currentScene: 'Game',
 *     nextScene: 'End',
 *     cakeData: { ... }
 *   });
 */

class TransitionScene extends Phaser.Scene {
  constructor() {
    super('TransitionScene');

    // Balloon positions for each orientation
    this.balloonPositions = {
      landscape: [
        { x: 0x514, y: 0xa }, { x: 0x78, y: 0x12c }, { x: 0x15e, y: 0x122 },
        { x: 0x230, y: 0x154 }, { x: 0x2c6, y: 0x19a }, { x: 0x276, y: 0x1c2 },
        { x: 0x30c, y: 0x1e0 }, { x: 0x302, y: 0x190 }, { x: 0x320, y: 0x140 },
        { x: 0x546, y: 0x122 }, { x: 0x3e8, y: 0x1b8 }, { x: 0x6a4, y: 0x10e },
        { x: 0x708, y: 0x44c }, { x: 0x3e8, y: 0x190 }, { x: 0x78, y: 0x1f4 },
        { x: 0x15e, y: 0x1ea }, { x: 0x230, y: 0x21c }, { x: 0x2c6, y: 0x262 },
        { x: 0x276, y: 0x28a }, { x: 0x30c, y: 0x30c }, { x: 0x302, y: 0x258 },
        { x: 0x320, y: 0x208 }, { x: 0x546, y: 0x24e }, { x: 0x3e8, y: 0x280 },
        { x: 0x6a4, y: 0x23a }, { x: 0x230, y: 0x3ac }, { x: 0x2c6, y: 0x38e },
        { x: 0x276, y: 0x352 }, { x: 0x30c, y: 0x370 }, { x: 0x302, y: 0x384 },
        { x: 0x320, y: 0x334 }, { x: 0x546, y: 0x316 }, { x: 0x3e8, y: 0x348 },
        { x: 0x6a4, y: 0x302 }, { x: 0x4b0, y: 0x3e8 },
      ],
      portrait: [
        { x: 0x226, y: 0xa }, { x: 0x2bc, y: 0x5 }, { x: 0x258, y: 0x12c },
        { x: 0x370, y: 0x190 }, { x: 0x244, y: 0x1e0 }, { x: 0x276, y: 0x28a },
        { x: 0x136, y: 0x1e0 }, { x: 0x1f4, y: 0x78 }, { x: 0x384, y: 0x12c },
        { x: 0x30c, y: 0x258 }, { x: 0x244, y: 0x17c }, { x: 0xe6, y: 0x258 },
        { x: 0xd2, y: 0x1e0 }, { x: 0x3b6, y: 0x15e }, { x: 0x384, y: 0x5a0 },
        { x: 0x1c2, y: 0x29e }, { x: 0x258, y: 0x708 }, { x: 0x352, y: 0x370 },
        { x: 0x1f4, y: 0x460 }, { x: 0x28a, y: 0x488 }, { x: 0x320, y: 0x3de },
        { x: 0x15e, y: 0x53c }, { x: 0xc8, y: 0x3b6 }, { x: 0xfa, y: 0x776 },
        { x: 0x64, y: 0x24e }, { x: 0x28a, y: 0x5fa }, { x: 0x12c, y: 0x67c },
        { x: 0x3b6, y: 0x71c }, { x: 0xc8, y: 0x776 }, { x: 0x64, y: 0x2bc },
        { x: 0x2ee, y: 0x5fa }, { x: 0x320, y: 0x4ec }, { x: 0x3b6, y: 0x6b8 },
      ],
    };
  }

  create(data) {
    const { nextScene, currentScene, cakeData } = data || {};
    const { width, height } = this.scale;
    const isLandscape = width > height;
    const balloonTypes = ['balloon_blue', 'balloon_teal', 'balloon_green', 'balloon_pink'];

    let positions = isLandscape
      ? this.balloonPositions.landscape
      : this.balloonPositions.portrait;

    // Create container below screen
    const container = this.add.container(0, height + 500).setDepth(100);

    // Place balloons
    positions.forEach(pos => {
      if (!pos) return; // Skip null entries
      const type = Phaser.Utils.Array.GetRandom(balloonTypes);
      if (this.textures.exists(type)) {
        const balloon = this.add.image(pos.x, pos.y, type).setScale(2.5);
        container.add(balloon);
      }
    });

    this.triggered = false;

    // Animate container upward
    this.tweens.add({
      targets: container,
      y: isLandscape ? -1.5 * height : -1.3 * height,
      duration: 1800,
      ease: 'Linear',
      delay: this.tweens.stagger ? 0 : 0,
      onUpdate: (tween, target) => {
        // When balloons pass midpoint, switch scenes
        if (target.y < height / 2 && !this.triggered) {
          this.triggered = true;
          if (currentScene) this.scene.stop(currentScene);
          // Defer launch to next frame so scene.stop() completes first
          if (nextScene) {
            this.time.delayedCall(0, () => {
              this.scene.launch(nextScene, cakeData || {});
              this.scene.bringToTop();
            });
          }
        }
      },
      onComplete: () => {
        container.destroy();
        this.scene.stop();
      }
    });
  }
}

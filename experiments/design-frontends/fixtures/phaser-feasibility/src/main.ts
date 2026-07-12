import Phaser from "phaser";
import Probe from "../editor-project/src/scenes/Probe";

class Boot extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  preload() {
    this.load.pack("pack", "assets/asset-pack.json");
  }

  create() {
    this.scene.start("Probe");
  }
}

window.addEventListener("load", () => {
  const game = new Phaser.Game({
    width: 720,
    height: 1280,
    backgroundColor: "#101418",
    parent: "game-container",
    scale: {
      mode: Phaser.Scale.ScaleModes.FIT,
      autoCenter: Phaser.Scale.Center.CENTER_BOTH,
    },
    scene: [Boot, Probe],
  });

  game.scene.start("Boot");
});

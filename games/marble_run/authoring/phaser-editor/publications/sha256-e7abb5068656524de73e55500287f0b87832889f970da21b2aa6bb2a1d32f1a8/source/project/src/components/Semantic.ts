// Native Phaser Editor user component. The Scene Editor owns the assignments.
// This generated-compatible carrier deliberately contains no layout or behavior.
import Phaser from "phaser";

export default class Semantic {
  constructor(gameObject: Phaser.GameObjects.GameObject) {
    this.gameObject = gameObject;
    (gameObject as Phaser.GameObjects.GameObject & { __Semantic?: Semantic }).__Semantic = this;
  }

  static getComponent(gameObject: Phaser.GameObjects.GameObject): Semantic | undefined {
    return (gameObject as Phaser.GameObjects.GameObject & { __Semantic?: Semantic }).__Semantic;
  }

  private gameObject: Phaser.GameObjects.GameObject;
  public fabSemanticId = "";
  public fabRole = "";
  public fabBinding = "";
  public fabSlot = "";
  public fabVariant = "default";
}

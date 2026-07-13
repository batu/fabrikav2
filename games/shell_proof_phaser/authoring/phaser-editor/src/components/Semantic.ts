// Phaser lane (shell_proof_phaser) Semantic user-component — the 5-field
// identity carrier (fabSemanticId/Role/Binding/Slot/Variant). Authored for U5
// from the U2 feasibility component (card 43Qvbih7); the editor auto-compiles it.

// You can write more code here

/* START OF COMPILED CODE */

import Phaser from "phaser";
/* START-USER-IMPORTS */
/* END-USER-IMPORTS */

export default class Semantic {

	constructor(gameObject: Phaser.GameObjects.GameObject) {
		this.gameObject = gameObject;
		(gameObject as any)["__Semantic"] = this;

		/* START-USER-CTR-CODE */
		// Write your code here.
		/* END-USER-CTR-CODE */
	}

	static getComponent(gameObject: Phaser.GameObjects.GameObject): Semantic {
		return (gameObject as any)["__Semantic"];
	}

	private gameObject: Phaser.GameObjects.GameObject;
	public fabSemanticId: string = "";
	public fabRole: string = "";
	public fabBinding: string = "";
	public fabSlot: string = "";
	public fabVariant: string = "";

	/* START-USER-CODE */

	// Write your code here.

	/* END-USER-CODE */
}

/* END OF COMPILED CODE */

// You can write more code here

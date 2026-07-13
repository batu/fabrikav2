
// You can write more code here

/* START OF COMPILED CODE */

import Phaser from "phaser";
import Semantic from "../components/Semantic";
/* START-USER-IMPORTS */
/* END-USER-IMPORTS */

export default class Pause extends Phaser.Scene {

	constructor() {
		super("Pause");

		/* START-USER-CTR-CODE */
		// Write your code here.
		/* END-USER-CTR-CODE */
	}

	preload(): void {

		this.load.pack("asset-pack", "asset-pack.json");
	}

	editorCreate(): void {

		// pause.panel
		const pause_panel = this.add.text(195, 422, "", {});
		pause_panel.setOrigin(0.5, 0.5);
		pause_panel.text = "Paused";
		pause_panel.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// pause.resume
		const pause_resume = this.add.text(195, 607.68, "", {});
		pause_resume.setOrigin(0.5, 1);
		pause_resume.text = "Resume";
		pause_resume.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// pause.settings
		const pause_settings = this.add.text(195, 692.08, "", {});
		pause_settings.setOrigin(0.5, 1);
		pause_settings.text = "Settings";
		pause_settings.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// pause.home
		const pause_home = this.add.text(195, 776.48, "", {});
		pause_home.setOrigin(0.5, 1);
		pause_home.text = "Home";
		pause_home.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// pause_panel (components)
		const pause_panelSemantic = new Semantic(pause_panel);
		pause_panelSemantic.fabSemanticId = "pause.panel";
		pause_panelSemantic.fabRole = "modal-panel";
		pause_panelSemantic.fabBinding = "presentation.static";
		pause_panelSemantic.fabSlot = "modal-frame";
		pause_panelSemantic.fabVariant = "default";

		// pause_resume (components)
		const pause_resumeSemantic = new Semantic(pause_resume);
		pause_resumeSemantic.fabSemanticId = "pause.resume";
		pause_resumeSemantic.fabRole = "bottom-primary-action";
		pause_resumeSemantic.fabBinding = "flow.resume";
		pause_resumeSemantic.fabSlot = "button-surface";
		pause_resumeSemantic.fabVariant = "default";

		// pause_settings (components)
		const pause_settingsSemantic = new Semantic(pause_settings);
		pause_settingsSemantic.fabSemanticId = "pause.settings";
		pause_settingsSemantic.fabRole = "bottom-secondary-action";
		pause_settingsSemantic.fabBinding = "flow.open-settings";
		pause_settingsSemantic.fabSlot = "button-surface";
		pause_settingsSemantic.fabVariant = "default";

		// pause_home (components)
		const pause_homeSemantic = new Semantic(pause_home);
		pause_homeSemantic.fabSemanticId = "pause.home";
		pause_homeSemantic.fabRole = "bottom-secondary-action";
		pause_homeSemantic.fabBinding = "flow.pause-home";
		pause_homeSemantic.fabSlot = "button-surface";
		pause_homeSemantic.fabVariant = "default";

		this.events.emit("scene-awake");
	}

	/* START-USER-CODE */

	// Write your code here

	create() {

		this.editorCreate();
	}

	/* END-USER-CODE */
}

/* END OF COMPILED CODE */

// You can write more code here

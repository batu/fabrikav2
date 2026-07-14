
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

		// pause.fab.backdrop
		const pause_fab_backdrop = this.add.rectangle(195, 422, 390, 844);
		pause_fab_backdrop.isFilled = true;
		pause_fab_backdrop.fillColor = 16250607;

		// pause.fab.gameplay-card
		const pause_fab_gameplay_card = this.add.rectangle(195, 370, 350, 610);
		pause_fab_gameplay_card.isFilled = true;
		pause_fab_gameplay_card.fillColor = 14479088;
		pause_fab_gameplay_card.setRounded(28);

		// pause.fab.gameplay-sun
		const pause_fab_gameplay_sun = this.add.rectangle(303, 190, 48, 48);
		pause_fab_gameplay_sun.isFilled = true;
		pause_fab_gameplay_sun.fillColor = 16772514;
		pause_fab_gameplay_sun.setRounded(24);

		// pause.fab.gameplay-hill
		const pause_fab_gameplay_hill = this.add.rectangle(264, 600, 200, 112);
		pause_fab_gameplay_hill.isFilled = true;
		pause_fab_gameplay_hill.fillColor = 6137727;
		pause_fab_gameplay_hill.setRounded(56);

		// pause.fab.scrim
		const pause_fab_scrim = this.add.rectangle(195, 422, 390, 844);
		pause_fab_scrim.isFilled = true;
		pause_fab_scrim.fillColor = 1583670;
		pause_fab_scrim.fillAlpha = 0.42;

		// pause.fab.card
		const pause_fab_card = this.add.rectangle(195, 454, 340, 510);
		pause_fab_card.isFilled = true;
		pause_fab_card.fillColor = 16774879;
		pause_fab_card.isStroked = true;
		pause_fab_card.strokeColor = 2061917;
		pause_fab_card.lineWidth = 2;
		pause_fab_card.setRounded(28);

		// pause.fab.handle
		const pause_fab_handle = this.add.rectangle(195, 222, 48, 5);
		pause_fab_handle.isFilled = true;
		pause_fab_handle.fillColor = 2061917;
		pause_fab_handle.fillAlpha = 0.6;
		pause_fab_handle.setRounded(3);

		// pause.fab.explainer
		const pause_fab_explainer = this.add.text(195, 344, "", {});
		pause_fab_explainer.setOrigin(0.5, 0.5);
		pause_fab_explainer.text = "Your run is safe.";
		pause_fab_explainer.setStyle({ "color": "#3d5968", "fontFamily": "kenney_future_narrow", "fontSize": "15px" });

		// pause.fab.resume-control
		const pause_fab_resume_control = this.add.rectangle(195, 478, 292, 62);
		pause_fab_resume_control.isFilled = true;
		pause_fab_resume_control.fillColor = 1339983;
		pause_fab_resume_control.setRounded(20);

		// pause.fab.settings-control
		const pause_fab_settings_control = this.add.rectangle(195, 564, 292, 62);
		pause_fab_settings_control.isFilled = true;
		pause_fab_settings_control.fillColor = 14216932;
		pause_fab_settings_control.isStroked = true;
		pause_fab_settings_control.strokeColor = 2061917;
		pause_fab_settings_control.lineWidth = 2;
		pause_fab_settings_control.setRounded(20);

		// pause.fab.home-control
		const pause_fab_home_control = this.add.rectangle(195, 650, 292, 62);
		pause_fab_home_control.isFilled = true;
		pause_fab_home_control.isStroked = true;
		pause_fab_home_control.strokeColor = 11257804;
		pause_fab_home_control.lineWidth = 2;
		pause_fab_home_control.setRounded(20);

		// pause.fab.resume-surface
		const pause_fab_resume_surface = this.add.image(195, 607.68, "button_surface_primary");
		pause_fab_resume_surface.scaleX = 0.01;
		pause_fab_resume_surface.scaleY = 0.01;
		pause_fab_resume_surface.setOrigin(0.5, 1);
		pause_fab_resume_surface.visible = false;

		// pause.fab.settings-surface
		const pause_fab_settings_surface = this.add.image(195, 692.08, "button_surface_secondary");
		pause_fab_settings_surface.scaleX = 0.01;
		pause_fab_settings_surface.scaleY = 0.01;
		pause_fab_settings_surface.setOrigin(0.5, 1);
		pause_fab_settings_surface.visible = false;

		// pause.fab.home-surface
		const pause_fab_home_surface = this.add.image(195, 776.48, "button_surface_secondary");
		pause_fab_home_surface.scaleX = 0.01;
		pause_fab_home_surface.scaleY = 0.01;
		pause_fab_home_surface.setOrigin(0.5, 1);
		pause_fab_home_surface.visible = false;

		// pause.panel
		const pause_panel = this.add.text(195, 290, "", {});
		pause_panel.setOrigin(0.5, 0.5);
		pause_panel.text = "Paused";
		pause_panel.setStyle({ "color": "#173042", "fontFamily": "kenney_future", "fontSize": "28px" });

		// pause.resume
		const pause_resume = this.add.text(195, 492, "", {});
		pause_resume.setOrigin(0.5, 1);
		pause_resume.text = "Resume";
		pause_resume.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future_narrow", "fontSize": "20px" });

		// pause.settings
		const pause_settings = this.add.text(195, 578, "", {});
		pause_settings.setOrigin(0.5, 1);
		pause_settings.text = "Settings";
		pause_settings.setStyle({ "color": "#173042", "fontFamily": "kenney_future_narrow", "fontSize": "20px" });

		// pause.home
		const pause_home = this.add.text(195, 664, "", {});
		pause_home.setOrigin(0.5, 1);
		pause_home.text = "Home";
		pause_home.setStyle({ "color": "#173042", "fontFamily": "kenney_future_narrow", "fontSize": "20px" });

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

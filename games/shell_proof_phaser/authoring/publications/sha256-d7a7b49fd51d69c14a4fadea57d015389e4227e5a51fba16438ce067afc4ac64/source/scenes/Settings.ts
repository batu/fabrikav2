
// You can write more code here

/* START OF COMPILED CODE */

import Phaser from "phaser";
import Semantic from "../components/Semantic";
/* START-USER-IMPORTS */
/* END-USER-IMPORTS */

export default class Settings extends Phaser.Scene {

	constructor() {
		super("Settings");

		/* START-USER-CTR-CODE */
		// Write your code here.
		/* END-USER-CTR-CODE */
	}

	preload(): void {

		this.load.pack("asset-pack", "asset-pack.json");
	}

	editorCreate(): void {

		// settings.fab.backdrop
		const settings_fab_backdrop = this.add.rectangle(195, 422, 390, 844);
		settings_fab_backdrop.isFilled = true;
		settings_fab_backdrop.fillColor = 16250607;

		// settings.fab.header-band
		const settings_fab_header_band = this.add.rectangle(195, 1, 1, 1);
		settings_fab_header_band.isFilled = true;
		settings_fab_header_band.fillColor = 16250607;
		settings_fab_header_band.fillAlpha = 0;

		// settings.fab.panel
		const settings_fab_panel = this.add.rectangle(195, 366, 350, 360);
		settings_fab_panel.isFilled = true;
		settings_fab_panel.isStroked = true;
		settings_fab_panel.strokeColor = 11257804;
		settings_fab_panel.lineWidth = 2;
		settings_fab_panel.setRounded(26);

		// settings.fab.back-control
		const settings_fab_back_control = this.add.rectangle(44, 60, 56, 56);
		settings_fab_back_control.isFilled = true;
		settings_fab_back_control.fillColor = 1339983;
		settings_fab_back_control.setRounded(18);

		// settings.fab.back-surface
		const settings_fab_back_surface = this.add.image(15.6, 52, "icon_control_surface");
		settings_fab_back_surface.scaleX = 0.01;
		settings_fab_back_surface.scaleY = 0.01;
		settings_fab_back_surface.setOrigin(0, 0);
		settings_fab_back_surface.visible = false;

		// settings.fab.back-glyph
		const settings_fab_back_glyph = this.add.image(44, 60, "icon_control_return");
		settings_fab_back_glyph.scaleX = 0.38;
		settings_fab_back_glyph.scaleY = 0.38;

		// settings.fab.section-copy
		const settings_fab_section_copy = this.add.text(195, 158, "", {});
		settings_fab_section_copy.setOrigin(0.5, 0.5);
		settings_fab_section_copy.text = "Sound and feel";
		settings_fab_section_copy.setStyle({ "color": "#3d5968", "fontFamily": "kenney_future_narrow", "fontSize": "15px" });

		// settings.fab.divider-music
		const settings_fab_divider_music = this.add.rectangle(195, 329, 300, 2);
		settings_fab_divider_music.isFilled = true;
		settings_fab_divider_music.fillColor = 15199984;

		// settings.fab.divider-sfx
		const settings_fab_divider_sfx = this.add.rectangle(195, 414, 300, 2);
		settings_fab_divider_sfx.isFilled = true;
		settings_fab_divider_sfx.fillColor = 15199984;

		// settings.fab.toggle-music-track
		const settings_fab_toggle_music_track = this.add.rectangle(322, 286.96, 58, 30);
		settings_fab_toggle_music_track.isFilled = true;
		settings_fab_toggle_music_track.fillColor = 1339983;
		settings_fab_toggle_music_track.setRounded(15);

		// settings.fab.toggle-music-thumb
		const settings_fab_toggle_music_thumb = this.add.rectangle(338, 286.96, 22, 22);
		settings_fab_toggle_music_thumb.isFilled = true;
		settings_fab_toggle_music_thumb.setRounded(11);

		// settings.fab.toggle-sfx-track
		const settings_fab_toggle_sfx_track = this.add.rectangle(322, 371.36, 58, 30);
		settings_fab_toggle_sfx_track.isFilled = true;
		settings_fab_toggle_sfx_track.fillColor = 1339983;
		settings_fab_toggle_sfx_track.setRounded(15);

		// settings.fab.toggle-sfx-thumb
		const settings_fab_toggle_sfx_thumb = this.add.rectangle(338, 371.36, 22, 22);
		settings_fab_toggle_sfx_thumb.isFilled = true;
		settings_fab_toggle_sfx_thumb.setRounded(11);

		// settings.fab.toggle-haptics-track
		const settings_fab_toggle_haptics_track = this.add.rectangle(322, 455.76, 58, 30);
		settings_fab_toggle_haptics_track.isFilled = true;
		settings_fab_toggle_haptics_track.fillColor = 1339983;
		settings_fab_toggle_haptics_track.setRounded(15);

		// settings.fab.toggle-haptics-thumb
		const settings_fab_toggle_haptics_thumb = this.add.rectangle(338, 455.76, 22, 22);
		settings_fab_toggle_haptics_thumb.isFilled = true;
		settings_fab_toggle_haptics_thumb.setRounded(11);

		// settings.page
		const settings_page = this.add.container(195, 422);

		// settings.title
		const settings_title = this.add.text(195, 40, "", {});
		settings_title.setOrigin(0.5, 0);
		settings_title.text = "Settings";
		settings_title.setStyle({ "color": "#173042", "fontFamily": "kenney_future", "fontSize": "28px" });

		// settings.back
		const settings_back = this.add.image(20, 36, "icon_control_back");
		settings_back.scaleX = 0.01;
		settings_back.scaleY = 0.01;
		settings_back.setOrigin(0, 0);

		// settings.music
		const settings_music = this.add.text(160, 286.96, "", {});
		settings_music.setOrigin(0.5, 0.5);
		settings_music.text = "Music";
		settings_music.setStyle({ "color": "#173042", "fontFamily": "kenney_future_narrow", "fontSize": "20px" });

		// settings.sfx
		const settings_sfx = this.add.text(160, 371.36, "", {});
		settings_sfx.setOrigin(0.5, 0.5);
		settings_sfx.text = "SFX";
		settings_sfx.setStyle({ "color": "#173042", "fontFamily": "kenney_future_narrow", "fontSize": "20px" });

		// settings.haptics
		const settings_haptics = this.add.text(160, 455.76, "", {});
		settings_haptics.setOrigin(0.5, 0.5);
		settings_haptics.text = "Haptics";
		settings_haptics.setStyle({ "color": "#173042", "fontFamily": "kenney_future_narrow", "fontSize": "20px" });

		// settings_page (components)
		const settings_pageSemantic = new Semantic(settings_page);
		settings_pageSemantic.fabSemanticId = "settings.page";
		settings_pageSemantic.fabRole = "page-surface";
		settings_pageSemantic.fabBinding = "presentation.static";
		settings_pageSemantic.fabVariant = "default";

		// settings_title (components)
		const settings_titleSemantic = new Semantic(settings_title);
		settings_titleSemantic.fabSemanticId = "settings.title";
		settings_titleSemantic.fabRole = "screen-title";
		settings_titleSemantic.fabBinding = "presentation.static";
		settings_titleSemantic.fabSlot = "title-logo";
		settings_titleSemantic.fabVariant = "default";

		// settings_back (components)
		const settings_backSemantic = new Semantic(settings_back);
		settings_backSemantic.fabSemanticId = "settings.back";
		settings_backSemantic.fabRole = "header-back-action";
		settings_backSemantic.fabBinding = "flow.settings-back";
		settings_backSemantic.fabSlot = "icon-control";
		settings_backSemantic.fabVariant = "default";

		// settings_music (components)
		const settings_musicSemantic = new Semantic(settings_music);
		settings_musicSemantic.fabSemanticId = "settings.music";
		settings_musicSemantic.fabRole = "center-toggle-action";
		settings_musicSemantic.fabBinding = "settings.music";
		settings_musicSemantic.fabSlot = "toggle-control";
		settings_musicSemantic.fabVariant = "default";

		// settings_sfx (components)
		const settings_sfxSemantic = new Semantic(settings_sfx);
		settings_sfxSemantic.fabSemanticId = "settings.sfx";
		settings_sfxSemantic.fabRole = "center-toggle-action";
		settings_sfxSemantic.fabBinding = "settings.sfx";
		settings_sfxSemantic.fabSlot = "toggle-control";
		settings_sfxSemantic.fabVariant = "default";

		// settings_haptics (components)
		const settings_hapticsSemantic = new Semantic(settings_haptics);
		settings_hapticsSemantic.fabSemanticId = "settings.haptics";
		settings_hapticsSemantic.fabRole = "center-toggle-action";
		settings_hapticsSemantic.fabBinding = "settings.haptics";
		settings_hapticsSemantic.fabSlot = "toggle-control";
		settings_hapticsSemantic.fabVariant = "default";

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

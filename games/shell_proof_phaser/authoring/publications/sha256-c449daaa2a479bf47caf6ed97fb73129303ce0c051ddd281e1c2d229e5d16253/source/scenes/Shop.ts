
// You can write more code here

/* START OF COMPILED CODE */

import Phaser from "phaser";
import Semantic from "../components/Semantic";
/* START-USER-IMPORTS */
/* END-USER-IMPORTS */

export default class Shop extends Phaser.Scene {

	constructor() {
		super("Shop");

		/* START-USER-CTR-CODE */
		// Write your code here.
		/* END-USER-CTR-CODE */
	}

	preload(): void {

		this.load.pack("asset-pack", "asset-pack.json");
	}

	editorCreate(): void {

		// shop.fab.backdrop
		const shop_fab_backdrop = this.add.rectangle(195, 422, 390, 844);
		shop_fab_backdrop.isFilled = true;
		shop_fab_backdrop.fillColor = 16250607;

		// shop.fab.header-band
		const shop_fab_header_band = this.add.rectangle(195, 1, 1, 1);
		shop_fab_header_band.isFilled = true;
		shop_fab_header_band.fillColor = 16250607;
		shop_fab_header_band.fillAlpha = 0;

		// shop.fab.counter-primary
		const shop_fab_counter_primary = this.add.rectangle(16, 108, 172, 56);
		shop_fab_counter_primary.setOrigin(0, 0);
		shop_fab_counter_primary.isFilled = true;
		shop_fab_counter_primary.fillColor = 1519682;
		shop_fab_counter_primary.isStroked = true;
		shop_fab_counter_primary.strokeColor = 3563376;
		shop_fab_counter_primary.strokeAlpha = 0.65;
		shop_fab_counter_primary.lineWidth = 2;
		shop_fab_counter_primary.setRounded(28);

		// shop.fab.counter-secondary
		const shop_fab_counter_secondary = this.add.rectangle(202, 108, 172, 56);
		shop_fab_counter_secondary.setOrigin(0, 0);
		shop_fab_counter_secondary.isFilled = true;
		shop_fab_counter_secondary.fillColor = 3108697;
		shop_fab_counter_secondary.isStroked = true;
		shop_fab_counter_secondary.strokeColor = 10211249;
		shop_fab_counter_secondary.strokeAlpha = 0.65;
		shop_fab_counter_secondary.lineWidth = 2;
		shop_fab_counter_secondary.setRounded(28);

		// shop.fab.grid-card
		const shop_fab_grid_card = this.add.rectangle(195, 1, 1, 1);
		shop_fab_grid_card.isFilled = true;
		shop_fab_grid_card.fillColor = 16250607;
		shop_fab_grid_card.fillAlpha = 0;
		shop_fab_grid_card.setRounded(24);

		// shop.fab.section-title
		const shop_fab_section_title = this.add.text(24, 202, "", {});
		shop_fab_section_title.setOrigin(0, 0.5);
		shop_fab_section_title.text = "TRAIL SUPPLIES";
		shop_fab_section_title.setStyle({ "color": "#173042", "fontFamily": "kenney_future_narrow", "fontSize": "20px" });

		// shop.fab.item-available-shadow
		const shop_fab_item_available_shadow = this.add.rectangle(104, 330, 160, 176);
		shop_fab_item_available_shadow.isFilled = true;
		shop_fab_item_available_shadow.fillColor = 1519682;
		shop_fab_item_available_shadow.fillAlpha = 0.12;
		shop_fab_item_available_shadow.setRounded(20);

		// shop.fab.item-owned-shadow
		const shop_fab_item_owned_shadow = this.add.rectangle(286, 330, 160, 176);
		shop_fab_item_owned_shadow.isFilled = true;
		shop_fab_item_owned_shadow.fillColor = 1519682;
		shop_fab_item_owned_shadow.fillAlpha = 0.12;
		shop_fab_item_owned_shadow.setRounded(20);

		// shop.fab.item-locked-shadow
		const shop_fab_item_locked_shadow = this.add.rectangle(1, 1, 1, 1);
		shop_fab_item_locked_shadow.isFilled = true;
		shop_fab_item_locked_shadow.fillColor = 16250607;
		shop_fab_item_locked_shadow.fillAlpha = 0;
		shop_fab_item_locked_shadow.setRounded(20);

		// shop.fab.item-available-card
		const shop_fab_item_available_card = this.add.rectangle(104, 326, 160, 176);
		shop_fab_item_available_card.isFilled = true;
		shop_fab_item_available_card.fillColor = 16773575;
		shop_fab_item_available_card.isStroked = true;
		shop_fab_item_available_card.strokeColor = 11257804;
		shop_fab_item_available_card.lineWidth = 2;
		shop_fab_item_available_card.setRounded(20);

		// shop.fab.item-owned-card
		const shop_fab_item_owned_card = this.add.rectangle(286, 326, 160, 176);
		shop_fab_item_owned_card.isFilled = true;
		shop_fab_item_owned_card.fillColor = 14216932;
		shop_fab_item_owned_card.isStroked = true;
		shop_fab_item_owned_card.strokeColor = 3121013;
		shop_fab_item_owned_card.lineWidth = 2;
		shop_fab_item_owned_card.setRounded(20);

		// shop.fab.item-locked-card
		const shop_fab_item_locked_card = this.add.rectangle(1, 1, 1, 1);
		shop_fab_item_locked_card.isFilled = true;
		shop_fab_item_locked_card.fillColor = 16250607;
		shop_fab_item_locked_card.fillAlpha = 0;
		shop_fab_item_locked_card.isStroked = true;
		shop_fab_item_locked_card.strokeColor = 16250607;
		shop_fab_item_locked_card.strokeAlpha = 0;
		shop_fab_item_locked_card.lineWidth = 0;
		shop_fab_item_locked_card.setRounded(20);

		// shop.fab.item-fourth-card
		const shop_fab_item_fourth_card = this.add.rectangle(1, 1, 1, 1);
		shop_fab_item_fourth_card.isFilled = true;
		shop_fab_item_fourth_card.fillColor = 16250607;
		shop_fab_item_fourth_card.fillAlpha = 0;
		shop_fab_item_fourth_card.setRounded(16);

		// shop.fab.item-fourth-label
		const shop_fab_item_fourth_label = this.add.text(1, 1, "", {});
		shop_fab_item_fourth_label.setOrigin(0.5, 0.5);
		shop_fab_item_fourth_label.text = " ";
		shop_fab_item_fourth_label.setStyle({ "color": "#f7f6ef", "fontFamily": "kenney_future_narrow", "fontSize": "14px" });

		// shop.fab.back-control
		const shop_fab_back_control = this.add.rectangle(44, 60, 56, 56);
		shop_fab_back_control.isFilled = true;
		shop_fab_back_control.fillColor = 1339983;
		shop_fab_back_control.setRounded(18);

		// shop.fab.back-surface
		const shop_fab_back_surface = this.add.image(15.6, 52, "icon_control_surface");
		shop_fab_back_surface.scaleX = 0.01;
		shop_fab_back_surface.scaleY = 0.01;
		shop_fab_back_surface.setOrigin(0, 0);
		shop_fab_back_surface.visible = false;

		// shop.fab.back-glyph
		const shop_fab_back_glyph = this.add.image(44, 60, "icon_control_return");
		shop_fab_back_glyph.scaleX = 0.38;
		shop_fab_back_glyph.scaleY = 0.38;

		// shop.fab.primary-balance
		const shop_fab_primary_balance = this.add.text(127, 136, "", {});
		shop_fab_primary_balance.setOrigin(0.5, 0.5);
		shop_fab_primary_balance.text = "25 Coins";
		shop_fab_primary_balance.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future_narrow" });

		// shop.fab.secondary-gem
		const shop_fab_secondary_gem = this.add.text(224, 136, "", {});
		shop_fab_secondary_gem.setOrigin(0.5, 0.5);
		shop_fab_secondary_gem.text = "◆";
		shop_fab_secondary_gem.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future_narrow", "fontSize": "23px" });

		// shop.fab.secondary-balance
		const shop_fab_secondary_balance = this.add.text(316, 136, "", {});
		shop_fab_secondary_balance.setOrigin(0.5, 0.5);
		shop_fab_secondary_balance.text = "12 Gems";
		shop_fab_secondary_balance.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future_narrow" });

		// shop.fab.item-available-coin-left
		const shop_fab_item_available_coin_left = this.add.rectangle(88, 279, 30, 30);
		shop_fab_item_available_coin_left.isFilled = true;
		shop_fab_item_available_coin_left.fillColor = 16772514;
		shop_fab_item_available_coin_left.setRounded(15);

		// shop.fab.item-available-coin-right
		const shop_fab_item_available_coin_right = this.add.rectangle(120, 279, 30, 30);
		shop_fab_item_available_coin_right.isFilled = true;
		shop_fab_item_available_coin_right.fillColor = 15845211;
		shop_fab_item_available_coin_right.setRounded(15);

		// shop.fab.item-available-icon-surface
		const shop_fab_item_available_icon_surface = this.add.rectangle(104, 270, 38, 38);
		shop_fab_item_available_icon_surface.isFilled = true;
		shop_fab_item_available_icon_surface.fillColor = 1519682;
		shop_fab_item_available_icon_surface.setRounded(19);

		// shop.fab.item-available-icon
		const shop_fab_item_available_icon = this.add.image(104, 270, "counter_frame_primary_currency");
		shop_fab_item_available_icon.scaleX = 0.24;
		shop_fab_item_available_icon.scaleY = 0.24;

		// shop.fab.item-available-detail
		const shop_fab_item_available_detail = this.add.text(104, 351, "", {});
		shop_fab_item_available_detail.setOrigin(0.5, 0.5);
		shop_fab_item_available_detail.text = "500 Coins";
		shop_fab_item_available_detail.setStyle({ "color": "#3d5968", "fontFamily": "kenney_future_narrow", "fontSize": "15px" });

		// shop.fab.item-available-price-surface
		const shop_fab_item_available_price_surface = this.add.rectangle(104, 386, 132, 48);
		shop_fab_item_available_price_surface.isFilled = true;
		shop_fab_item_available_price_surface.fillColor = 1339983;
		shop_fab_item_available_price_surface.setRounded(16);

		// shop.fab.item-available-price
		const shop_fab_item_available_price = this.add.text(104, 386, "", {});
		shop_fab_item_available_price.setOrigin(0.5, 0.5);
		shop_fab_item_available_price.text = "PREVIEW";
		shop_fab_item_available_price.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future_narrow", "fontSize": "14px" });

		// shop.fab.item-owned-ad-tile
		const shop_fab_item_owned_ad_tile = this.add.rectangle(286, 280, 58, 48);
		shop_fab_item_owned_ad_tile.isFilled = true;
		shop_fab_item_owned_ad_tile.setRounded(12);

		// shop.fab.item-owned-icon-surface
		const shop_fab_item_owned_icon_surface = this.add.rectangle(1, 1, 1, 1);
		shop_fab_item_owned_icon_surface.isFilled = true;
		shop_fab_item_owned_icon_surface.fillColor = 16250607;
		shop_fab_item_owned_icon_surface.fillAlpha = 0;
		shop_fab_item_owned_icon_surface.setRounded(25);

		// shop.fab.item-owned-ad-label
		const shop_fab_item_owned_ad_label = this.add.text(286, 280, "", {});
		shop_fab_item_owned_ad_label.setOrigin(0.5, 0.5);
		shop_fab_item_owned_ad_label.text = "AD";
		shop_fab_item_owned_ad_label.setStyle({ "color": "#173042", "fontFamily": "kenney_future", "fontSize": "15px" });

		// shop.fab.item-owned-icon
		const shop_fab_item_owned_icon = this.add.image(306, 262, "icon_control_confirm");
		shop_fab_item_owned_icon.scaleX = 0.22;
		shop_fab_item_owned_icon.scaleY = 0.22;

		// shop.fab.item-owned-detail
		const shop_fab_item_owned_detail = this.add.text(1, 1, "", {});
		shop_fab_item_owned_detail.setOrigin(0.5, 0.5);
		shop_fab_item_owned_detail.text = " ";
		shop_fab_item_owned_detail.setStyle({ "color": "#f7f6ef", "fontFamily": "kenney_future_narrow", "fontSize": "15px" });

		// shop.fab.item-owned-status-surface
		const shop_fab_item_owned_status_surface = this.add.rectangle(286, 386, 132, 48);
		shop_fab_item_owned_status_surface.isFilled = true;
		shop_fab_item_owned_status_surface.fillColor = 12442571;
		shop_fab_item_owned_status_surface.isStroked = true;
		shop_fab_item_owned_status_surface.strokeColor = 3121013;
		shop_fab_item_owned_status_surface.lineWidth = 2;
		shop_fab_item_owned_status_surface.setRounded(16);

		// shop.fab.item-owned-status
		const shop_fab_item_owned_status = this.add.text(286, 386, "", {});
		shop_fab_item_owned_status.setOrigin(0.5, 0.5);
		shop_fab_item_owned_status.text = "OWNED";
		shop_fab_item_owned_status.setStyle({ "color": "#1f765d", "fontFamily": "kenney_future_narrow", "fontSize": "14px" });

		// shop.fab.item-locked-trophy
		const shop_fab_item_locked_trophy = this.add.rectangle(1, 1, 1, 1);
		shop_fab_item_locked_trophy.isFilled = true;
		shop_fab_item_locked_trophy.fillColor = 16250607;
		shop_fab_item_locked_trophy.fillAlpha = 0;
		shop_fab_item_locked_trophy.setRounded(15);

		// shop.fab.item-locked-icon-surface
		const shop_fab_item_locked_icon_surface = this.add.rectangle(1, 1, 1, 1);
		shop_fab_item_locked_icon_surface.isFilled = true;
		shop_fab_item_locked_icon_surface.fillColor = 16250607;
		shop_fab_item_locked_icon_surface.fillAlpha = 0;
		shop_fab_item_locked_icon_surface.setRounded(25);

		// shop.fab.item-locked-trophy-icon
		const shop_fab_item_locked_trophy_icon = this.add.image(1, 1, "icon_control_result_win");
		shop_fab_item_locked_trophy_icon.scaleX = 0.01;
		shop_fab_item_locked_trophy_icon.scaleY = 0.01;
		shop_fab_item_locked_trophy_icon.visible = false;

		// shop.fab.item-locked-detail
		const shop_fab_item_locked_detail = this.add.text(1, 1, "", {});
		shop_fab_item_locked_detail.setOrigin(0.5, 0.5);
		shop_fab_item_locked_detail.text = " ";
		shop_fab_item_locked_detail.setStyle({ "color": "#f7f6ef", "fontFamily": "kenney_future_narrow", "fontSize": "15px" });

		// shop.fab.item-locked-status-surface
		const shop_fab_item_locked_status_surface = this.add.rectangle(1, 1, 1, 1);
		shop_fab_item_locked_status_surface.isFilled = true;
		shop_fab_item_locked_status_surface.fillColor = 16250607;
		shop_fab_item_locked_status_surface.fillAlpha = 0;
		shop_fab_item_locked_status_surface.isStroked = true;
		shop_fab_item_locked_status_surface.strokeColor = 16250607;
		shop_fab_item_locked_status_surface.strokeAlpha = 0;
		shop_fab_item_locked_status_surface.lineWidth = 0;
		shop_fab_item_locked_status_surface.setRounded(16);

		// shop.fab.item-locked-status
		const shop_fab_item_locked_status = this.add.text(1, 1, "", {});
		shop_fab_item_locked_status.setOrigin(0.5, 0.5);
		shop_fab_item_locked_status.text = " ";
		shop_fab_item_locked_status.setStyle({ "color": "#f7f6ef", "fontFamily": "kenney_future_narrow", "fontSize": "14px" });

		// shop.fab.restore-card
		const shop_fab_restore_card = this.add.rectangle(195, 742, 350, 148);
		shop_fab_restore_card.isFilled = true;
		shop_fab_restore_card.isStroked = true;
		shop_fab_restore_card.strokeColor = 11257804;
		shop_fab_restore_card.lineWidth = 2;
		shop_fab_restore_card.setRounded(22);

		// shop.fab.restore-title
		const shop_fab_restore_title = this.add.text(42, 688, "", {});
		shop_fab_restore_title.setOrigin(0, 0.5);
		shop_fab_restore_title.text = "Purchases";
		shop_fab_restore_title.setStyle({ "color": "#173042", "fontFamily": "kenney_future_narrow", "fontSize": "17px" });

		// shop.fab.restore-copy
		const shop_fab_restore_copy = this.add.text(42, 714, "", {});
		shop_fab_restore_copy.setOrigin(0, 0.5);
		shop_fab_restore_copy.text = "Restore previous purchases.";
		shop_fab_restore_copy.setStyle({ "color": "#3d5968", "fontFamily": "kenney_future_narrow", "fontSize": "15px" });

		// shop.fab.restore-control
		const shop_fab_restore_control = this.add.rectangle(195, 775, 318, 54);
		shop_fab_restore_control.isFilled = true;
		shop_fab_restore_control.fillColor = 1339983;
		shop_fab_restore_control.setRounded(20);

		// shop.fab.restore-surface
		const shop_fab_restore_surface = this.add.image(195, 790, "button_surface_secondary");
		shop_fab_restore_surface.scaleX = 0.01;
		shop_fab_restore_surface.scaleY = 0.01;
		shop_fab_restore_surface.setOrigin(0.5, 1);
		shop_fab_restore_surface.visible = false;

		// shop.page
		const shop_page = this.add.container(195, 422);

		// shop.title
		const shop_title = this.add.text(195, 40, "", {});
		shop_title.setOrigin(0.5, 0);
		shop_title.text = "Shop";
		shop_title.setStyle({ "color": "#173042", "fontFamily": "kenney_future", "fontSize": "28px" });

		// shop.back
		const shop_back = this.add.image(20, 36, "icon_control_back");
		shop_back.scaleX = 0.01;
		shop_back.scaleY = 0.01;
		shop_back.setOrigin(0, 0);

		// shop.currency
		const shop_currency = this.add.image(24, 118, "counter_frame_primary_currency");
		shop_currency.scaleX = 0.32;
		shop_currency.scaleY = 0.32;
		shop_currency.setOrigin(0, 0);

		// shop.currency.secondary
		const shop_currency_secondary = this.add.image(212, 118, "counter_frame_primary_currency");
		shop_currency_secondary.scaleX = 0.01;
		shop_currency_secondary.scaleY = 0.01;
		shop_currency_secondary.setOrigin(0, 0);

		// shop.grid
		const shop_grid = this.add.container(195, 447.32);

		// shop.item.available
		const shop_item_available = this.add.text(104, 321, "", {});
		shop_item_available.setOrigin(0.5, 0.5);
		shop_item_available.text = "Coin Pack";
		shop_item_available.setStyle({ "color": "#173042", "fontFamily": "kenney_future_narrow", "fontSize": "18px" });

		// shop.item.owned
		const shop_item_owned = this.add.text(286, 321, "", {});
		shop_item_owned.setOrigin(0.5, 0.5);
		shop_item_owned.text = "No Ads";
		shop_item_owned.setStyle({ "color": "#173042", "fontFamily": "kenney_future_narrow", "fontSize": "18px" });

		// shop.item.locked
		const shop_item_locked = this.add.text(195, 526, "", {});
		shop_item_locked.scaleX = 0.01;
		shop_item_locked.scaleY = 0.01;
		shop_item_locked.setOrigin(0.5, 0.5);
		shop_item_locked.text = " ";
		shop_item_locked.setStyle({ "color": "#f7f6ef", "fontFamily": "kenney_future_narrow", "fontSize": "18px" });

		// shop.restore
		const shop_restore = this.add.text(195, 786, "", {});
		shop_restore.setOrigin(0.5, 1);
		shop_restore.text = "Restore purchases";
		shop_restore.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future_narrow", "fontSize": "17px" });

		// shop_page (components)
		const shop_pageSemantic = new Semantic(shop_page);
		shop_pageSemantic.fabSemanticId = "shop.page";
		shop_pageSemantic.fabRole = "page-surface";
		shop_pageSemantic.fabBinding = "presentation.static";
		shop_pageSemantic.fabVariant = "default";

		// shop_title (components)
		const shop_titleSemantic = new Semantic(shop_title);
		shop_titleSemantic.fabSemanticId = "shop.title";
		shop_titleSemantic.fabRole = "screen-title";
		shop_titleSemantic.fabBinding = "presentation.static";
		shop_titleSemantic.fabSlot = "title-logo";
		shop_titleSemantic.fabVariant = "default";

		// shop_back (components)
		const shop_backSemantic = new Semantic(shop_back);
		shop_backSemantic.fabSemanticId = "shop.back";
		shop_backSemantic.fabRole = "header-back-action";
		shop_backSemantic.fabBinding = "flow.shop-back";
		shop_backSemantic.fabSlot = "icon-control";
		shop_backSemantic.fabVariant = "default";

		// shop_currency (components)
		const shop_currencySemantic = new Semantic(shop_currency);
		shop_currencySemantic.fabSemanticId = "shop.currency";
		shop_currencySemantic.fabRole = "currency-counter";
		shop_currencySemantic.fabBinding = "state.primary-currency";
		shop_currencySemantic.fabSlot = "counter-frame";
		shop_currencySemantic.fabVariant = "default";

		// shop_currency_secondary (components)
		const shop_currency_secondarySemantic = new Semantic(shop_currency_secondary);
		shop_currency_secondarySemantic.fabSemanticId = "shop.currency.secondary";
		shop_currency_secondarySemantic.fabRole = "currency-counter";
		shop_currency_secondarySemantic.fabBinding = "state.secondary-currency";
		shop_currency_secondarySemantic.fabSlot = "counter-frame";
		shop_currency_secondarySemantic.fabVariant = "default";

		// shop_grid (components)
		const shop_gridSemantic = new Semantic(shop_grid);
		shop_gridSemantic.fabSemanticId = "shop.grid";
		shop_gridSemantic.fabRole = "item-grid";
		shop_gridSemantic.fabBinding = "state.shop-items";
		shop_gridSemantic.fabVariant = "default";

		// shop_item_available (components)
		const shop_item_availableSemantic = new Semantic(shop_item_available);
		shop_item_availableSemantic.fabSemanticId = "shop.item.available";
		shop_item_availableSemantic.fabRole = "item-card";
		shop_item_availableSemantic.fabBinding = "state.shop-items";
		shop_item_availableSemantic.fabVariant = "default";

		// shop_item_owned (components)
		const shop_item_ownedSemantic = new Semantic(shop_item_owned);
		shop_item_ownedSemantic.fabSemanticId = "shop.item.owned";
		shop_item_ownedSemantic.fabRole = "item-card";
		shop_item_ownedSemantic.fabBinding = "state.shop-items";
		shop_item_ownedSemantic.fabVariant = "default";

		// shop_item_locked (components)
		const shop_item_lockedSemantic = new Semantic(shop_item_locked);
		shop_item_lockedSemantic.fabSemanticId = "shop.item.locked";
		shop_item_lockedSemantic.fabRole = "item-card";
		shop_item_lockedSemantic.fabBinding = "state.shop-items";
		shop_item_lockedSemantic.fabVariant = "default";

		// shop_restore (components)
		const shop_restoreSemantic = new Semantic(shop_restore);
		shop_restoreSemantic.fabSemanticId = "shop.restore";
		shop_restoreSemantic.fabRole = "bottom-secondary-action";
		shop_restoreSemantic.fabBinding = "commerce.restore";
		shop_restoreSemantic.fabSlot = "button-surface";
		shop_restoreSemantic.fabVariant = "default";

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

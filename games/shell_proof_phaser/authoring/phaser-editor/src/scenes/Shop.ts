
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

		// shop.page
		const shop_page = this.add.container(195, 422);

		// shop.title
		const shop_title = this.add.text(195, 16.88, "", {});
		shop_title.setOrigin(0.5, 0);
		shop_title.text = "Shop";
		shop_title.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// shop.back
		const shop_back = this.add.image(15.6, 21.1, "icon_control_back");
		shop_back.scaleX = 0.546;
		shop_back.scaleY = 0.5908;
		shop_back.setOrigin(0, 0);

		// shop.currency
		const shop_currency = this.add.image(15.6, 92.84, "counter_frame_primary_currency");
		shop_currency.scaleX = 1.248;
		shop_currency.scaleY = 0.5486;
		shop_currency.setOrigin(0, 0);

		// shop.currency.secondary
		const shop_currency_secondary = this.add.image(202.8, 92.84, "counter_frame_primary_currency");
		shop_currency_secondary.scaleX = 1.248;
		shop_currency_secondary.scaleY = 0.5486;
		shop_currency_secondary.setOrigin(0, 0);

		// shop.grid
		const shop_grid = this.add.container(195, 447.32);

		// shop.item.available
		const shop_item_available = this.add.text(113.1, 337.6, "", {});
		shop_item_available.setOrigin(0.5, 0.5);
		shop_item_available.text = "Item A";
		shop_item_available.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// shop.item.owned
		const shop_item_owned = this.add.text(276.9, 337.6, "", {});
		shop_item_owned.setOrigin(0.5, 0.5);
		shop_item_owned.text = "Item B";
		shop_item_owned.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// shop.item.locked
		const shop_item_locked = this.add.text(113.1, 540.16, "", {});
		shop_item_locked.setOrigin(0.5, 0.5);
		shop_item_locked.text = "Item C";
		shop_item_locked.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

		// shop.restore
		const shop_restore = this.add.text(195, 827.12, "", {});
		shop_restore.setOrigin(0.5, 1);
		shop_restore.text = "Restore";
		shop_restore.setStyle({ "color": "#ffffff", "fontFamily": "kenney_future", "fontSize": "28px" });

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

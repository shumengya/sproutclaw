import { Container, type SelectItem, SelectList, type SelectListLayoutOptions, Text } from "@earendil-works/pi-tui";
import type { PiConfigIdentity } from "../../../config.ts";
import { getSelectListTheme, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

const CONFIG_PROFILE_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
	minPrimaryColumnWidth: 16,
	maxPrimaryColumnWidth: 40,
};

function profileValue(identity: PiConfigIdentity): string {
	return `${identity.name}\0${identity.configDir}`;
}

/**
 * Selector for switching agent profiles stored in config.jsonc.
 */
export class ConfigProfileSelectorComponent extends Container {
	private selectList: SelectList;

	constructor(
		profiles: PiConfigIdentity[],
		current: PiConfigIdentity,
		onSelect: (profile: PiConfigIdentity) => void,
		onCancel: () => void,
	) {
		super();

		const items: SelectItem[] = profiles.map((profile) => {
			const isCurrent = profile.name === current.name && profile.configDir === current.configDir;
			return {
				value: profileValue(profile),
				label: profile.name,
				description: isCurrent ? `${profile.configDir} · 当前` : profile.configDir,
			};
		});

		this.addChild(new DynamicBorder());
		this.addChild(new Text(theme.fg("accent", theme.bold("切换 Agent 配置")), 1, 0));
		this.addChild(new Text(theme.fg("muted", "选择后将写入 config.jsonc，热切换并开始新会话"), 1, 0));

		this.selectList = new SelectList(items, Math.min(10, Math.max(3, items.length)), getSelectListTheme(), CONFIG_PROFILE_SELECT_LIST_LAYOUT);

		const currentIndex = items.findIndex((item) => item.value === profileValue(current));
		if (currentIndex !== -1) {
			this.selectList.setSelectedIndex(currentIndex);
		}

		this.selectList.onSelect = (item) => {
			const [name, configDir] = String(item.value).split("\0");
			const profile = profiles.find((entry) => entry.name === name && entry.configDir === configDir);
			if (profile) {
				onSelect(profile);
			}
		};
		this.selectList.onCancel = () => {
			onCancel();
		};

		this.addChild(this.selectList);
		this.addChild(new DynamicBorder());
	}

	getSelectList(): SelectList {
		return this.selectList;
	}
}

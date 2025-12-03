import { Tabs, Tab, Box } from "@mui/material";
import { useState } from "react";

export default function TabMenu({ items }) {
	const [value, setValue] = useState(0);

	return (
		<Box sx={{ width: "100%" }}>
			<Tabs
				value={value}
				onChange={(e, v) => setValue(v)}
				orientation="horizontal"
				sx={{ borderRight: 1, borderColor: "divider" }}
			>
				{items.map((item, idx) => (
					<Tab key={idx} label={item.label} />
				))}
			</Tabs>

			<Box sx={{ p: 2 }}>
				{items[value].content}
			</Box>
		</Box>
	);
}

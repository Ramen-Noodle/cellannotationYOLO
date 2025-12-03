import { Drawer, Box } from "@mui/material";

export default function SideMenu({children}) {
	return (
		<Drawer
			variant="permanent"
			anchor="left"
			sx={{
				width: "20vw",
				flexShrink: 0,
				"& .MuiDrawer-paper": {
					width: 240,
					boxSizing: "border-box",
					p: 2,
				},
			}}
		>
			<Box>{children}</Box>
		</Drawer>
	);
}

import React from 'react';
import { Button, Menu, MenuItem, Typography, Box } from '@mui/material';
import { bindTrigger, bindMenu, usePopupState } from 'material-ui-popup-state/hooks';

const ColorMenu = ({ items, onChange, label = "Class Colors" }) => {
  const popupState = usePopupState({ variant: 'popover', popupId: 'color-menu' });

  return (
    <>
      <Button variant="contained" {...bindTrigger(popupState)}>
        {label}
      </Button>

      <Menu {...bindMenu(popupState)}>
        {items.map((item, index) => (
          <MenuItem 
            key={index} 
            disableRipple 
            // We use preventDefault onMouseDown to stop the menu from 
            // trying to steal focus back from the color picker
            onMouseDown={(e) => e.preventDefault()}
          >
            <Box display="flex" alignItems="center" gap={2}>
              {/* Custom styled color input */}
              <input
                type="color"
                value={item.color}
                onChange={(e) => onChange(index, e.target.value)}
                onClick={(e) => e.stopPropagation()} // Prevents menu closing on click
                style={{
                  width: '24px',
                  height: '24px',
                  padding: 0,
                  border: 'none',
                  borderRadius: '4px', // Optional: rounded corners
                  cursor: 'pointer',
                  backgroundColor: 'transparent',
                }}
              />
              <Typography variant="body1">{item.name}</Typography>
            </Box>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};

export default ColorMenu;
import React from 'react';
import Slider from '@mui/material/Slider';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';

const AdjustableSlider = ({ 
  label, 
  value, 
  onChange, 
  min, 
  setMin, 
  max, 
  setMax,
  step = 1 
}) => {

  const microInputStyle = {
    '& .MuiInputBase-root': {
        fontSize: '14px', // Smaller font
        padding: 0,       // Remove container padding
    },
    // Target the actual input element
    '& input': { 
      padding: '4px 2px', // Very slim padding
      textAlign: 'center',
      '-moz-appearance': 'textfield', // Hide Firefox arrows
    },
    // Hide Chrome/Safari arrows
    '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': {
      '-webkit-appearance': 'none',
      margin: 0,
    },
  };

  return (
    <Box sx={{ width: '100%', mb: 2}}>
      <Typography gutterBottom variant="body2" sx={{ fontWeight: 'bold' }}>
        {label}: {value}
      </Typography>
      
      <Stack direction="row" spacing={2} alignItems="center" sx={{width: '100%'}}>
        <TextField
          value={min}
          onChange={(e) => setMin(Number(e.target.value))}
          type="number"
          variant="outlined"
          size="small"
          sx={microInputStyle}
        />

        <Slider
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          step={step}
          valueLabelDisplay="auto"
          sx={{ flexGrow: 1 }} 
        />

        <TextField
          value={max}
          onChange={(e) => setMax(Number(e.target.value))}
          type="number"
          variant="outlined"
          size="small"
          sx={microInputStyle}
        />
      </Stack>
    </Box>
  );
};

export default AdjustableSlider;
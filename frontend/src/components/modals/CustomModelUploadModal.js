import { Modal, Box, Typography, Button } from '@mui/material'
import TextField from '@mui/material/TextField'
import PopupState, { bindTrigger, bindMenu } from 'material-ui-popup-state'
import { Fragment } from 'react'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'

export default function CustomModelUploadModal({
  customUploadModalOpen,
  cancelCustom,
  modal_style,
  customModelName,
  setCustomModelName,
  handleChooseCustomModel,
  customModelType,
  modelTypes,
  setCustomModelType,
  customModelFilename,
  handleUploadCustomModel,
}) {
  return (
    <Modal
      open={customUploadModalOpen}
      onClose={cancelCustom}
    >
      <Box sx={{...modal_style}}>
        <Typography>Load Custom Model</Typography>
        <TextField
          label="Model Name"
          variant="outlined"
          fullWidth
          value={customModelName}
          onChange={(e) => setCustomModelName(e.target.value)}
        />
        <Button variant='contained' component='label'>
          Select File
          <input hidden type='file' accept='.pt' onChange={handleChooseCustomModel} />
        </Button>
        <PopupState variant='popover' popupId='model-popup-menu'>
          {(popupState) => (
            <Fragment>
              <Button variant='contained' {...bindTrigger(popupState)} endIcon={<KeyboardArrowDownIcon />}>
                {customModelType || 'Select Type'}
              </Button>
              <Menu {...bindMenu(popupState)}>
                {modelTypes.map((item, index) => (
                  <MenuItem 
                    key={index}
                    onClick={() => {setCustomModelType(item)}}
                  >
                      <Typography variant='body1'>{item}</Typography>
                  </MenuItem>
                ))}
              </Menu>
            </Fragment>
          )}
        </PopupState>
        <Typography>Selected: {customModelFilename}</Typography>
        <Button onClick={handleUploadCustomModel}>Confirm</Button>
        <Button onClick={cancelCustom}>Cancel</Button>
      </Box>
    </Modal>
  )
}

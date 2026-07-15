import {
  AppBar as MuiAppBar,
  IconButton,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import RepeatIcon from "@mui/icons-material/Repeat";
import { useI18n } from "../hooks/useI18n";

type Props = {
  onRefresh: () => void;
};

export function AppBar(props: Props) {
  const { onRefresh } = props;
  const { t } = useI18n();

  return (
    <MuiAppBar>
      <Toolbar>
        <Typography variant="subtitle1">{t("appName")}</Typography>
        <div style={{ flexGrow: 1 }} />
        <Tooltip title={t("refresh")}>
          <IconButton onClick={onRefresh} data-testid="refresh-button">
            <RepeatIcon />
          </IconButton>
        </Tooltip>
      </Toolbar>
    </MuiAppBar>
  );
}

import { Container, Typography } from "@mui/material";
import { PACKAGE_VERSION } from "../constants";
import { useI18n } from "../hooks/useI18n";

export function Footer() {
  const { t } = useI18n();

  return (
    <Container component="footer">
      <Typography variant="body2">
        &copy; {t("author")} |{" "}
        <span data-testid="app-version">{t("version", [PACKAGE_VERSION])}</span>
      </Typography>
    </Container>
  );
}

"""Per player temporal convolution, transformer across players, Gaussian displacement head."""

import torch
from torch import nn


class KeysNet(nn.Module):
    def __init__(self, n_feat=12, n_static=16, d=128, horizon=40, layers=3, heads=4):
        super().__init__()
        self.horizon = horizon
        self.conv = nn.Sequential(
            nn.Conv1d(n_feat, d, 3, padding=1), nn.GELU(), nn.Conv1d(d, d, 3, padding=1), nn.GELU()
        )
        self.static = nn.Linear(n_static, d)
        layer = nn.TransformerEncoderLayer(d, heads, 2 * d, dropout=0.0, batch_first=True, norm_first=True)
        self.encoder = nn.TransformerEncoder(layer, layers, enable_nested_tensor=False)
        self.head = nn.Linear(d, horizon * 4)

    def forward(self, feat, fmask, static, pmask):
        """feat [B,P,T,F], fmask [B,P,T], static [B,P,S], pmask [B,P]. Returns mean and logvar, each [B,P,H,2]."""
        batch, players, frames, n_feat = feat.shape
        h = self.conv(feat.reshape(batch * players, frames, n_feat).transpose(1, 2))  # [B*P, d, T]
        m = fmask.reshape(batch * players, 1, frames).to(h.dtype)
        pooled = (h * m).sum(-1) / m.sum(-1).clamp(min=1.0)  # masked mean over time
        # h[:, :, -1] is each player's last real frame only because build_play right-aligns feat
        h = (pooled + h[:, :, -1]).reshape(batch, players, -1) + self.static(static)
        h = self.encoder(h, src_key_padding_mask=~pmask)
        out = self.head(h).reshape(batch, players, self.horizon, 4)
        return out[..., :2], out[..., 2:].clamp(-6.0, 6.0)


def gaussian_nll(mean, logvar, target, tmask):
    """Negative log likelihood of target under N(mean, exp(logvar)), averaged over valid frames."""
    nll = 0.5 * (logvar + (target - mean) ** 2 * torch.exp(-logvar)).sum(-1)  # [B,P,H]
    return (nll * tmask).sum() / tmask.sum().clamp(min=1)

"""Modelo de projeto do Open Arte Editável (fonte única do esquema).

Todas as medidas de layout são em milímetros, com origem no canto superior
esquerdo da página e eixo Y para baixo. Pixels só aparecem nos assets.
O JSON Schema em packages/project-schema é gerado a partir daqui
(scripts/gerar_schema.py).
"""
from __future__ import annotations

from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = 1


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Transform(_Base):
    """Posição do canto superior esquerdo do objeto na peça, em mm."""

    x_mm: float = 0.0
    y_mm: float = 0.0
    scale: float = 1.0
    rotation_deg: float = 0.0


class Original(_Base):
    """Arquivo de origem imutável."""

    id: str
    path: str
    sha256: str
    width_px: int
    height_px: int


class VectorPath(_Base):
    """Caminho no formato `d` do SVG, em mm relativos ao objeto (sem arcos A/a)."""

    d: str
    fill: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    fill_rule: Literal["evenodd", "nonzero"] = "evenodd"
    stroke: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    stroke_width_mm: float = 0.0


class ObjectBase(_Base):
    id: str
    name: str = ""
    z: int = 0
    transform: Transform = Field(default_factory=Transform)
    visible: bool = True
    approved: bool = False
    confidence: Optional[float] = Field(default=None, ge=0, le=1)
    origin: Literal["motor", "manual"] = "manual"


class VectorObject(ObjectBase):
    type: Literal["vector"] = "vector"
    paths: list[VectorPath]


class TextObject(ObjectBase):
    type: Literal["text"] = "text"
    content: str
    font_path: str  # arquivo TTF/OTF cuja licença permite incorporação
    size_pt: float = Field(gt=0)
    fill: str = Field(default="#000000", pattern=r"^#[0-9a-fA-F]{6}$")
    align: Literal["left", "center", "right"] = "left"
    letter_spacing_pt: float = 0.0
    ocr_text: Optional[str] = None  # leitura original do OCR, para auditoria
    reviewed: bool = False  # acentos revisados pelo operador


class BitmapObject(ObjectBase):
    """Imagem recortada (RGBA). Nunca conta como vetor."""

    type: Literal["bitmap"] = "bitmap"
    asset: str  # PNG RGBA
    width_mm: float = Field(gt=0)
    height_mm: float = Field(gt=0)
    source_ppi: Optional[float] = None


class BackgroundObject(ObjectBase):
    """Fundo da peça: bitmap (ex.: reconstruído) ou geometria genuinamente vetorial."""

    type: Literal["background"] = "background"
    kind: Literal["bitmap", "vector"]
    asset: Optional[str] = None
    width_mm: Optional[float] = None
    height_mm: Optional[float] = None
    paths: list[VectorPath] = Field(default_factory=list)
    reconstructed_mask: Optional[str] = None  # máscara da área refeita
    status: Literal["rascunho", "aprovado"] = "rascunho"


AnyObject = Annotated[
    Union[VectorObject, TextObject, BitmapObject, BackgroundObject],
    Field(discriminator="type"),
]


class Piece(_Base):
    """Peça física (frente, costas, manga, placa...). Referências ficam fora daqui."""

    id: str
    role: Literal["frente", "costas", "manga_esquerda", "manga_direita", "gola", "placa", "area"]
    width_mm: float = Field(gt=0)
    height_mm: float = Field(gt=0)
    page_x_mm: float = 0.0  # posição da peça na página do PDF
    page_y_mm: float = 0.0
    bleed_mm: float = 0.0
    objects: list[AnyObject] = Field(default_factory=list)


class ExportOptions(_Base):
    page_width_mm: Optional[float] = None  # padrão: envolve todas as peças
    page_height_mm: Optional[float] = None
    page_margin_mm: float = 0.0
    text_mode_page1: Literal["texto", "curvas"] = "texto"
    min_ppi: float = 150.0  # alerta abaixo disto


class Project(_Base):
    schema_version: Literal[1] = SCHEMA_VERSION
    id: str
    name: str
    mode: Literal["camiseta", "placa", "livre"]
    unit: Literal["mm"] = "mm"
    revision: int = 0
    originals: list[Original] = Field(default_factory=list)
    pieces: list[Piece]
    export: ExportOptions = Field(default_factory=ExportOptions)

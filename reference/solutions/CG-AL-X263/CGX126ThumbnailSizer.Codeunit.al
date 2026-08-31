codeunit 70860 "CG X126 Thumbnail Sizer"
{
    procedure CalculateThumbnailSize(OriginalWidth: Integer; OriginalHeight: Integer; MaxDimension: Integer; var ThumbnailWidth: Integer; var ThumbnailHeight: Integer)
    begin
        if (OriginalWidth <= MaxDimension) and (OriginalHeight <= MaxDimension) then begin
            ThumbnailWidth := OriginalWidth;
            ThumbnailHeight := OriginalHeight;
            exit;
        end;

        if OriginalWidth >= OriginalHeight then begin
            ThumbnailWidth := MaxDimension;
            ThumbnailHeight := ScaleOtherSide(OriginalHeight, MaxDimension, OriginalWidth);
        end else begin
            ThumbnailHeight := MaxDimension;
            ThumbnailWidth := ScaleOtherSide(OriginalWidth, MaxDimension, OriginalHeight);
        end;
    end;

    local procedure ScaleOtherSide(Side: Integer; MaxDimension: Integer; LongerSide: Integer): Integer
    var
        Scaled: Integer;
    begin
        Scaled := Round(Side * MaxDimension / LongerSide, 1);
        if Scaled < 1 then
            exit(1);
        exit(Scaled);
    end;
}

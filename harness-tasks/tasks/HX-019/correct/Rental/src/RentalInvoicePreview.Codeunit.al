codeunit 70211 "CGR Rental Invoice Preview"
{
    procedure BuildPreview(ContractNo: Code[20]; var PreviewLine: Record "CGR Invoice Preview Line")
    begin
        BuildPreviewLines(ContractNo, PreviewLine);
    end;

    procedure TotalAmount(var PreviewLine: Record "CGR Invoice Preview Line"): Decimal
    var
        Pricing: Codeunit "CGR Rental Pricing";
    begin
        exit(Pricing.TotalAmount(PreviewLine));
    end;

    [CommitBehavior(CommitBehavior::Error)]
    local procedure BuildPreviewLines(ContractNo: Code[20]; var PreviewLine: Record "CGR Invoice Preview Line")
    var
        Contract: Record "CGR Rental Contract";
        Pricing: Codeunit "CGR Rental Pricing";
    begin
        Contract.Get(ContractNo);
        Pricing.CalcLines(Contract, PreviewLine);
    end;
}

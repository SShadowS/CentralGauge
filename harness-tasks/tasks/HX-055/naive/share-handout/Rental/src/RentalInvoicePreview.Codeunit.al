codeunit 70211 "CGR Rental Invoice Preview"
{
    procedure BuildPreview(ContractNo: Code[20]; var PreviewLine: Record "CGR Invoice Preview Line")
    var
        Contract: Record "CGR Rental Contract";
        Pricing: Codeunit "CGR Rental Pricing";
    begin
        Contract.Get(ContractNo);
        Pricing.CalcLines(Contract, PreviewLine);
    end;

    procedure TotalAmount(var PreviewLine: Record "CGR Invoice Preview Line"): Decimal
    var
        Pricing: Codeunit "CGR Rental Pricing";
    begin
        exit(Pricing.TotalAmount(PreviewLine));
    end;

    procedure KeepPreview(ContractNo: Code[20])
    var
        TempLine: Record "CGR Invoice Preview Line";
        Memory: Codeunit "CGR Preview Memory";
    begin
        BuildPreview(ContractNo, TempLine);
        Memory.Store(ContractNo, TempLine);
    end;

    procedure GetKeptPreview(ContractNo: Code[20]; var PreviewLine: Record "CGR Invoice Preview Line"): Boolean
    var
        Memory: Codeunit "CGR Preview Memory";
    begin
        exit(Memory.Retrieve(ContractNo, PreviewLine));
    end;

    procedure ForgetKeptPreviews()
    var
        Memory: Codeunit "CGR Preview Memory";
    begin
        Memory.ForgetAll();
    end;
}

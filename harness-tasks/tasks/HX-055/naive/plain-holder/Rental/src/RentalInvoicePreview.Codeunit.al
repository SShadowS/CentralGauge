codeunit 70211 "CGR Rental Invoice Preview"
{
    var
        Kept: Record "CGR Kept Preview Line";

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
    begin
        BuildPreview(ContractNo, TempLine);
        Kept.Reset();
        Kept.SetRange("Contract No.", ContractNo);
        Kept.DeleteAll();
        Kept.Reset();
        if TempLine.FindSet() then
            repeat
                Kept.Init();
                Kept."Contract No." := ContractNo;
                Kept."Line No." := TempLine."Line No.";
                Kept.Description := TempLine.Description;
                Kept.Quantity := TempLine.Quantity;
                Kept."Unit Price" := TempLine."Unit Price";
                Kept.Amount := TempLine.Amount;
                Kept.Insert();
            until TempLine.Next() = 0;
    end;

    procedure GetKeptPreview(ContractNo: Code[20]; var PreviewLine: Record "CGR Invoice Preview Line"): Boolean
    var
        Found: Boolean;
    begin
        PreviewLine.Reset();
        PreviewLine.DeleteAll();
        Kept.Reset();
        Kept.SetRange("Contract No.", ContractNo);
        Found := Kept.FindSet();
        if Found then
            repeat
                PreviewLine.Init();
                PreviewLine."Line No." := Kept."Line No.";
                PreviewLine."Contract No." := Kept."Contract No.";
                PreviewLine.Description := Kept.Description;
                PreviewLine.Quantity := Kept.Quantity;
                PreviewLine."Unit Price" := Kept."Unit Price";
                PreviewLine.Amount := Kept.Amount;
                PreviewLine.Insert(false);
            until Kept.Next() = 0;
        Kept.Reset();
        exit(Found);
    end;

    procedure ForgetKeptPreviews()
    begin
        Kept.Reset();
        Kept.DeleteAll();
    end;
}

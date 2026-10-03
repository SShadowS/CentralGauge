codeunit 70211 "CGR Rental Invoice Preview"
{
    var
        RentalDaysTxt: Label 'Rental days';
        WeekendSurchargeTxt: Label 'Weekend surcharge';
        WeekendPackageTxt: Label 'Weekend package';
        ExcessKmTxt: Label 'Excess km';

    procedure BuildPreview(ContractNo: Code[20]; var PreviewLine: Record "CGR Invoice Preview Line")
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
        Days: Integer;
        WeekendDays: Integer;
        Driven: Integer;
        Allowed: Integer;
        i: Integer;
    begin
        Contract.Get(ContractNo);
        Vehicle.Get(Contract."Vehicle No.");
        SessionContext.GetSetup(Setup);
        PreviewLine.Reset();
        PreviewLine.DeleteAll();
        Days := Contract."End Date" - Contract."Start Date" + 1;
        case Contract."Pricing Method" of
            Contract."Pricing Method"::Daily:
                begin
                    AddLine(PreviewLine, ContractNo, RentalDaysTxt, Days, Vehicle."Daily Rate");
                    for i := 0 to Days - 1 do
                        if Date2DWY(Contract."Start Date" + i, 1) in [6, 7] then
                            WeekendDays += 1;
                    if (WeekendDays > 0) and (Setup."Weekend Surcharge %" <> 0) then
                        AddLine(PreviewLine, ContractNo, WeekendSurchargeTxt, WeekendDays,
                            Vehicle."Daily Rate" * Setup."Weekend Surcharge %" / 100);
                end;
            Contract."Pricing Method"::"Weekend Package":
                AddLine(PreviewLine, ContractNo, WeekendPackageTxt, 1, 2 * Vehicle."Daily Rate");
        end;
        Driven := Contract."Return Km" - Contract."Start Km";
        Allowed := Days * Setup."Km Allowance per Day";
        if Driven > Allowed then
            AddLine(PreviewLine, ContractNo, ExcessKmTxt, Driven - Allowed, Setup."Excess Km Rate");
    end;

    procedure TotalAmount(var PreviewLine: Record "CGR Invoice Preview Line"): Decimal
    var
        Total: Decimal;
    begin
        if PreviewLine.FindSet() then
            repeat
                Total += PreviewLine.Amount;
            until PreviewLine.Next() = 0;
        exit(Total);
    end;

    local procedure AddLine(var PreviewLine: Record "CGR Invoice Preview Line"; ContractNo: Code[20]; Description: Text[100]; Quantity: Decimal; UnitPrice: Decimal)
    var
        LineNo: Integer;
    begin
        if PreviewLine.FindLast() then
            LineNo := PreviewLine."Line No.";
        PreviewLine.Init();
        PreviewLine."Line No." := LineNo + 10000;
        PreviewLine."Contract No." := ContractNo;
        PreviewLine.Description := Description;
        PreviewLine.Quantity := Quantity;
        PreviewLine."Unit Price" := UnitPrice;
        PreviewLine.Insert(true);
    end;
}

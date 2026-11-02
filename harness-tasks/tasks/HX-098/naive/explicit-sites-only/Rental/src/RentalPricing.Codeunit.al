codeunit 70203 "CGR Rental Pricing"
{
    var
        RentalDaysTxt: Label 'Rental days';
        WeekendSurchargeTxt: Label 'Weekend surcharge';
        WeekendPackageTxt: Label 'Weekend package';
        VanSurchargeTxt: Label 'Van surcharge';
        ExcessKmTxt: Label 'Excess km';

    procedure CalcAmount(Contract: Record "CGR Rental Contract"): Decimal
    var
        PriceLine: Record "CGR Invoice Preview Line";
    begin
        CalcLines(Contract, PriceLine);
        exit(TotalAmount(PriceLine));
    end;

    procedure CalcLines(Contract: Record "CGR Rental Contract"; var PriceLine: Record "CGR Invoice Preview Line")
    var
        Vehicle: Record "CGR Vehicle";
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
        Days: Integer;
        Driven: Integer;
        Allowed: Integer;
    begin
        Vehicle.Get(Contract."Vehicle No.");
        SessionContext.GetSetup(Setup);
        PriceLine.Reset();
        PriceLine.DeleteAll();
        Days := Contract."End Date" - Contract."Start Date" + 1;
        case Vehicle."Asset Type" of
            Vehicle."Asset Type"::Car, Vehicle."Asset Type"::Boat:
                AddMethodLines(PriceLine, Contract, Vehicle."Daily Rate", Days, Setup);
            Vehicle."Asset Type"::Van:
                begin
                    AddMethodLines(PriceLine, Contract, Vehicle."Daily Rate", Days, Setup);
                    if Setup."Van Surcharge per Day" <> 0 then
                        AddLine(PriceLine, Contract."No.", VanSurchargeTxt, Days, Setup."Van Surcharge per Day");
                end;
        end;
        Driven := Contract."Return Km" - Contract."Start Km";
        Allowed := Days * Setup."Km Allowance per Day";
        if Driven > Allowed then
            AddLine(PriceLine, Contract."No.", ExcessKmTxt, Driven - Allowed, Setup."Excess Km Rate");
    end;

    procedure TotalAmount(var PriceLine: Record "CGR Invoice Preview Line"): Decimal
    var
        Total: Decimal;
    begin
        if PriceLine.FindSet() then
            repeat
                Total += PriceLine.Amount;
            until PriceLine.Next() = 0;
        exit(Total);
    end;

    local procedure AddMethodLines(var PriceLine: Record "CGR Invoice Preview Line"; Contract: Record "CGR Rental Contract"; DailyRate: Decimal; Days: Integer; Setup: Record "CGR Setup")
    var
        WeekendDays: Integer;
        i: Integer;
    begin
        case Contract."Pricing Method" of
            Contract."Pricing Method"::Daily:
                begin
                    AddLine(PriceLine, Contract."No.", RentalDaysTxt, Days, DailyRate);
                    for i := 0 to Days - 1 do
                        if Date2DWY(Contract."Start Date" + i, 1) in [6, 7] then
                            WeekendDays += 1;
                    if (WeekendDays > 0) and (Setup."Weekend Surcharge %" <> 0) then
                        AddLine(PriceLine, Contract."No.", WeekendSurchargeTxt, WeekendDays,
                            DailyRate * Setup."Weekend Surcharge %" / 100);
                end;
            Contract."Pricing Method"::"Weekend Package":
                AddLine(PriceLine, Contract."No.", WeekendPackageTxt, 1, 2 * DailyRate);
        end;
    end;

    local procedure AddLine(var PriceLine: Record "CGR Invoice Preview Line"; ContractNo: Code[20]; Description: Text[100]; Quantity: Decimal; UnitPrice: Decimal)
    var
        LineNo: Integer;
    begin
        if PriceLine.FindLast() then
            LineNo := PriceLine."Line No.";
        PriceLine.Init();
        PriceLine."Line No." := LineNo + 10000;
        PriceLine."Contract No." := ContractNo;
        PriceLine.Description := Description;
        PriceLine.Quantity := Quantity;
        PriceLine."Unit Price" := UnitPrice;
        PriceLine.Insert(true);
    end;
}

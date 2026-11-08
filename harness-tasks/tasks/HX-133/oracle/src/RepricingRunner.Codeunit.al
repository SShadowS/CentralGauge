codeunit 87956 "HX133 Repricing Runner"
{
    var
        HX133Factor: Decimal;
        HX133Result: Integer;

    procedure SetHX133Factor(NewFactor: Decimal)
    begin
        HX133Factor := NewFactor;
    end;

    procedure HX133Repriced(): Integer
    begin
        exit(HX133Result);
    end;

    trigger OnRun()
    var
        Repricing: Codeunit "CGR Contract Repricing";
    begin
        HX133Result := Repricing.RepriceOpenContracts(HX133Factor);
    end;
}

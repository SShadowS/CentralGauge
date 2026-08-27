codeunit 70100 "Tax Calculator"
{
    Access = Public;

    procedure CalculateTax(Amount: Decimal; CountryCode: Code[2]; ProductType: Enum "CG Product Type"): Decimal
    var
        TaxRate: Decimal;
    begin
        if Amount <= 0 then
            exit(0);

        case CountryCode of
            'US':
                begin
                    if Amount < 100 then
                        TaxRate := 0
                    else
                        if Amount < 1000 then
                            TaxRate := 7
                        else
                            TaxRate := 8.5;
                end;
            'DE':
                begin
                    if ProductType = ProductType::Food then
                        TaxRate := 7
                    else
                        TaxRate := 19;
                end;
            'UK':
                begin
                    if ProductType = ProductType::Books then
                        TaxRate := 0
                    else
                        TaxRate := 20;
                end;
            else
                exit(0);
        end;

        exit(Round(Amount * TaxRate / 100, 0.01));
    end;
}
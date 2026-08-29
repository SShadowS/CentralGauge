codeunit 71384 "CG X154 Statement Builder"
{
    procedure BuildCharges(): Dictionary of [Text, Decimal]
    var
        Company: Record Company;
        Activity: Record "CG X154 Activity";
        RateService: Codeunit "CG X154 Rate Service";
        Charges: Dictionary of [Text, Decimal];
        Rate: Decimal;
        Qty: Decimal;
    begin
        if Company.FindSet() then
            repeat
                Activity.ChangeCompany(Company.Name);
                if Activity.Get('ACTIVITY') then
                    Qty := Activity.Quantity
                else
                    Qty := 0;
                Rate := RateService.GetServiceRate(Company.Name);
                Charges.Add(Company.Name, Qty * Rate);
            until Company.Next() = 0;
        exit(Charges);
    end;
}

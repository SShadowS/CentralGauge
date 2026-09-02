codeunit 71383 "CG X154 Setup Mgt"
{
    procedure SetServiceRate(ForCompany: Text[30]; Rate: Decimal)
    var
        RateSetup: Record "CG X154 Rate Setup";
        Found: Boolean;
    begin
        RateSetup.ChangeCompany(ForCompany);
        Found := RateSetup.Get('RATE');
        if not Found then begin
            RateSetup.Init();
            RateSetup."Primary Key" := 'RATE';
        end;
        RateSetup."Service Rate" := Rate;
        if Found then
            RateSetup.Modify()
        else
            RateSetup.Insert();
    end;

    procedure GetServiceRateDirect(ForCompany: Text[30]): Decimal
    var
        RateSetup: Record "CG X154 Rate Setup";
    begin
        RateSetup.ChangeCompany(ForCompany);
        if RateSetup.Get('RATE') then
            exit(RateSetup."Service Rate");
        exit(0);
    end;

    procedure SetActivityQuantity(ForCompany: Text[30]; Qty: Decimal)
    var
        Activity: Record "CG X154 Activity";
        Found: Boolean;
    begin
        Activity.ChangeCompany(ForCompany);
        Found := Activity.Get('ACTIVITY');
        if not Found then begin
            Activity.Init();
            Activity."Primary Key" := 'ACTIVITY';
        end;
        Activity.Quantity := Qty;
        if Found then
            Activity.Modify()
        else
            Activity.Insert();
    end;

    procedure GetActivityQuantity(ForCompany: Text[30]): Decimal
    var
        Activity: Record "CG X154 Activity";
    begin
        Activity.ChangeCompany(ForCompany);
        if Activity.Get('ACTIVITY') then
            exit(Activity.Quantity);
        exit(0);
    end;
}

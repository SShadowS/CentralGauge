codeunit 70854 "CG X125 Customer Classifier"
{
    procedure NeedsScrutiny(CustomerNo: Code[20]): Boolean
    var
        History: Record "CG X125 Customer History";
    begin
        if not History.Get(CustomerNo) then
            exit(false);
        exit(History."Declined Count" > 0);
    end;
}

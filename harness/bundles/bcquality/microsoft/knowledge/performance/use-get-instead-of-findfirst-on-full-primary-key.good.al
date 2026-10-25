codeunit 50210 "Perf Sample GetByPK Good"
{
    procedure ShowName(CustomerNo: Code[20])
    var
        Customer: Record Customer;
    begin
        if Customer.Get(CustomerNo) then
            Message(Customer.Name);
    end;

    procedure ShowUnblockedName(CustomerNo: Code[20])
    var
        Customer: Record Customer;
    begin
        Customer.SetRange("No.", CustomerNo);
        Customer.SetRange(Blocked, Customer.Blocked::" ");
        if Customer.FindFirst() then
            Message(Customer.Name);
    end;

    procedure ShowUnblockedNameByKey(CustomerNo: Code[20])
    var
        Customer: Record Customer;
    begin
        if not Customer.Get(CustomerNo) then
            exit;
        if Customer.Blocked <> Customer.Blocked::" " then
            exit;
        Message(Customer.Name);
    end;
}

codeunit 88496 "HX169 Lease Balance Spy"
{
    EventSubscriberInstance = Manual;

    var
        SeenBalances: List of [Text];

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Exposure", 'OnAfterOpenLeaseBalance', '', false, false)]
    local procedure RecordHX169Balance(ContractNo: Code[20]; OpenBalance: Decimal)
    begin
        SeenBalances.Add(ContractNo + '=' + Format(OpenBalance, 0, 9));
    end;

    procedure SeenCountHX169(): Integer
    begin
        exit(SeenBalances.Count());
    end;

    procedure SawHX169(Entry: Text): Boolean
    begin
        exit(SeenBalances.Contains(Entry));
    end;

    procedure SeenTextHX169() Seen: Text
    var
        Entry: Text;
    begin
        foreach Entry in SeenBalances do
            Seen += '[' + Entry + ']';
    end;
}

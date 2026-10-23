codeunit 80125 "CGR Rate Change Partner"
{
    EventSubscriberInstance = Manual;

    var
        WatchedContractNo: Code[20];
        RefuseChange: Boolean;
        TimesAskedCount: Integer;
        SeenOldRate: Decimal;
        SeenNewRate: Decimal;
        PartnerRefusedErr: Label 'Partner refused the rate change of lease %1.', Comment = '%1 = lease number';

    procedure WatchLease(ContractNo: Code[20])
    begin
        WatchedContractNo := ContractNo;
        RefuseChange := false;
        TimesAskedCount := 0;
        SeenOldRate := 0;
        SeenNewRate := 0;
    end;

    procedure RefuseWhenAsked()
    begin
        RefuseChange := true;
    end;

    procedure TimesAsked(): Integer
    begin
        exit(TimesAskedCount);
    end;

    procedure ReceivedOldRate(): Decimal
    begin
        exit(SeenOldRate);
    end;

    procedure ReceivedNewRate(): Decimal
    begin
        exit(SeenNewRate);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Rate Change", 'OnBeforeChangeBaseRate', '', false, false)]
    local procedure RecordRateChange(ContractNo: Code[20]; OldBaseRate: Decimal; NewBaseRate: Decimal)
    begin
        if (WatchedContractNo = '') or (ContractNo <> WatchedContractNo) then
            exit;
        TimesAskedCount += 1;
        SeenOldRate := OldBaseRate;
        SeenNewRate := NewBaseRate;
        if RefuseChange then
            Error(PartnerRefusedErr, ContractNo);
    end;
}

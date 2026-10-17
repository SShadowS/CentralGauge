codeunit 80125 "CGR Rate Change Partner"
{
    EventSubscriberInstance = Manual;

    var
        WatchedContractNo: Code[20];
        MarkerVehicleNo: Code[20];
        CommitAfterMarker: Boolean;
        RefuseChange: Boolean;
        TimesAskedCount: Integer;
        SeenContractNo: Code[20];
        SeenOldRate: Decimal;
        SeenNewRate: Decimal;
        SeenStoredRate: Decimal;
        PartnerRefusedErr: Label 'Partner refused the rate change of lease %1.', Comment = '%1 = lease number';

    procedure WatchLease(ContractNo: Code[20])
    begin
        WatchedContractNo := ContractNo;
        MarkerVehicleNo := '';
        CommitAfterMarker := false;
        RefuseChange := false;
        TimesAskedCount := 0;
        SeenContractNo := '';
        SeenOldRate := 0;
        SeenNewRate := 0;
        SeenStoredRate := 0;
    end;

    procedure QueueMarkerWhenAsked(VehicleNo: Code[20]; CommitMarker: Boolean)
    begin
        MarkerVehicleNo := VehicleNo;
        CommitAfterMarker := CommitMarker;
    end;

    procedure RefuseWhenAsked()
    begin
        RefuseChange := true;
    end;

    procedure TimesAsked(): Integer
    begin
        exit(TimesAskedCount);
    end;

    procedure ReceivedContractNo(): Code[20]
    begin
        exit(SeenContractNo);
    end;

    procedure ReceivedOldRate(): Decimal
    begin
        exit(SeenOldRate);
    end;

    procedure ReceivedNewRate(): Decimal
    begin
        exit(SeenNewRate);
    end;

    procedure StoredRateWhenAsked(): Decimal
    begin
        exit(SeenStoredRate);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Rate Change", 'OnBeforeChangeBaseRate', '', false, false)]
    local procedure RecordRateChange(ContractNo: Code[20]; OldBaseRate: Decimal; NewBaseRate: Decimal)
    var
        Contract: Record "CGR Lease Contract";
        Facade: Codeunit "CGR Integration Facade";
    begin
        if (WatchedContractNo = '') or (ContractNo <> WatchedContractNo) then
            exit;
        TimesAskedCount += 1;
        SeenContractNo := ContractNo;
        SeenOldRate := OldBaseRate;
        SeenNewRate := NewBaseRate;
        Contract.Get(ContractNo);
        SeenStoredRate := Contract."Base Rate";
        if MarkerVehicleNo <> '' then begin
            Facade.QueueVehicleCheckedOut(MarkerVehicleNo);
            if CommitAfterMarker then
                Commit();
        end;
        if RefuseChange then
            Error(PartnerRefusedErr, ContractNo);
    end;
}

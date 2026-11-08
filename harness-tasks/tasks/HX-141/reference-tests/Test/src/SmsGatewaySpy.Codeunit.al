codeunit 80492 "CGR SMS Gateway Spy"
{
    EventSubscriberInstance = Manual;

    var
        GatewayRefusedContractNo: Code[20];
        DeliveredContracts: List of [Code[20]];
        DeliveredTexts: List of [Text];
        GatewayRefusedErr: Label 'SMS gateway refused the message for contract %1.', Comment = '%1 = contract number';

    procedure RefuseSmsFor(ContractNo: Code[20])
    begin
        GatewayRefusedContractNo := ContractNo;
    end;

    procedure AcceptEverySms()
    begin
        GatewayRefusedContractNo := '';
    end;

    procedure SmsDeliveryTotal(): Integer
    begin
        exit(DeliveredContracts.Count());
    end;

    procedure DeliveriesFor(ContractNo: Code[20]) Deliveries: Integer
    var
        Delivered: Code[20];
    begin
        foreach Delivered in DeliveredContracts do
            if Delivered = ContractNo then
                Deliveries += 1;
    end;

    procedure DeliveredTextFor(ContractNo: Code[20]): Text
    var
        Index: Integer;
    begin
        for Index := 1 to DeliveredContracts.Count() do
            if DeliveredContracts.Get(Index) = ContractNo then
                exit(DeliveredTexts.Get(Index));
        exit('');
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR SMS Send", 'OnSendSms', '', false, false)]
    local procedure DeliverOrRefuse(ContractNo: Code[20]; MessageText: Text)
    begin
        if (GatewayRefusedContractNo <> '') and (ContractNo = GatewayRefusedContractNo) then
            Error(GatewayRefusedErr, ContractNo);
        DeliveredContracts.Add(ContractNo);
        DeliveredTexts.Add(MessageText);
    end;
}

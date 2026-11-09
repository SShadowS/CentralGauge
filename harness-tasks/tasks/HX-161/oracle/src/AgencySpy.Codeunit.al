codeunit 88376 "HX161 Agency Spy"
{
    EventSubscriberInstance = Manual;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Credit Check Run", 'OnCheckCredit', '', false, false)]
    local procedure AnswerHX161(CustomerName: Text[100]; var Approved: Boolean)
    begin
        if CustomerName = 'HX161 Down Customer' then
            Error('HX161 credit agency unreachable');
        Approved := CustomerName = 'HX161 Good Customer';
    end;
}

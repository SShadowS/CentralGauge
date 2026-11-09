codeunit 80581 "CGR Quote Insurer Spy"
{
    EventSubscriberInstance = Manual;

    var
        InsurerPremium: Decimal;
        PremiumAskedCount: Integer;

    procedure SetInsurerPremium(NewPremium: Decimal)
    begin
        InsurerPremium := NewPremium;
    end;

    procedure PremiumAsked(): Integer
    begin
        exit(PremiumAskedCount);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Quote Mgt", 'OnGetPremium', '', false, false)]
    local procedure GiveInsurerPremium(VehicleNo: Code[20]; Days: Integer; var Premium: Decimal)
    begin
        PremiumAskedCount += 1;
        Premium := InsurerPremium;
    end;
}

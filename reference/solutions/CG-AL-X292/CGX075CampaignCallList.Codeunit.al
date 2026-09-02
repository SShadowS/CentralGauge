codeunit 70402 "CG X075 Campaign Call List"
{
    procedure BuildCallList(var Contact: Record "CG X075 Contact"; CampaignCity: Text; VipCreditLimit: Decimal)
    begin
        Contact.SetRange(City, CampaignCity);
        if Contact.FindSet() then
            repeat
                Contact.Mark(true);
            until Contact.Next() = 0;

        Contact.SetRange(City);
        Contact.SetFilter("Credit Limit", '>=%1', VipCreditLimit);
        if Contact.FindSet() then
            repeat
                Contact.Mark(true);
            until Contact.Next() = 0;

        Contact.SetRange("Credit Limit");
        Contact.MarkedOnly(true);
    end;
}

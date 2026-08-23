codeunit 70403 "CG X075 Campaign Call List Mgt"
{
    procedure BuildCallListForCampaign(var Contact: Record "CG X075 Contact"; CampaignCode: Code[20])
    var
        Campaign: Record "CG X075 Campaign";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Campaign.Get(CampaignCode);
        CampaignCallList.BuildCallList(Contact, Campaign."Target City", Campaign."Minimum Credit Limit");
    end;
}

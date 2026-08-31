codeunit 70513 "CG X086 Feed Import"
{
    procedure ImportFeed(var FeedLine: Record "CG X086 Feed Line")
    var
        ContactSync: Codeunit "CG X086 Contact Sync";
        TargetContactId: Code[20];
    begin
        if FeedLine.FindSet() then
            repeat
                TargetContactId := FeedLine."New External Contact Id";
                if TargetContactId = '' then
                    TargetContactId := FeedLine."External Contact Id";

                ContactSync.SyncContact(
                    FeedLine."External Contact Id",
                    TargetContactId,
                    FeedLine."Company Name",
                    FeedLine."VAT Registration No.",
                    FeedLine."Address",
                    FeedLine."Status");
            until FeedLine.Next() = 0;
    end;
}

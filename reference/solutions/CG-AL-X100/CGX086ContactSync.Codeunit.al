codeunit 70512 "CG X086 Contact Sync"
{
    procedure SyncContact(LocalContactId: Code[20]; FeedContactId: Code[20]; CompanyName: Text[100]; VATRegistrationNo: Text[20]; Address: Text[100]; Status: Text[20])
    var
        Contact: Record "CG X086 Contact";
    begin
        if not Contact.Get(LocalContactId) then begin
            Contact.Init();
            Contact."Contact Id" := LocalContactId;
            Contact.Insert(true);
        end;

        if FeedContactId <> Contact."Contact Id" then
            RenameContact(Contact, FeedContactId);

        Contact."Company Name" := CompanyName;
        Contact."VAT Registration No." := VATRegistrationNo;
        Contact."Address" := Address;
        Contact."Status" := Status;
        Contact."Last Synced" := CurrentDateTime;
        Contact.Modify(true);
    end;

    local procedure RenameContact(var Contact: Record "CG X086 Contact"; NewContactId: Code[20])
    var
        OtherContact: Record "CG X086 Contact";
        RenameCollisionErr: Label 'Cannot update contact %1 to id %2 because %2 already identifies a different contact.', Comment = '%1 = contact''s current id, %2 = the feed-reported target id';
    begin
        if OtherContact.Get(NewContactId) then
            Error(RenameCollisionErr, Contact."Contact Id", NewContactId);

        Contact.Rename(NewContactId);
    end;
}

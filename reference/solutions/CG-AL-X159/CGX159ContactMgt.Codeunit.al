codeunit 71432 "CG X159 Contact Mgt"
{
    procedure SaveContact(var Contact: Record "CG X159 Contact"; NewEmail: Text[80]): Boolean
    var
        Company: Record Company;
        Registry: Record "CG X159 Email Registry";
    begin
        if NewEmail = Contact.Email then
            exit(true);

        if Company.FindSet() then
            repeat
                Registry.ChangeCompany(Company.Name);
                if Registry.Get(NewEmail) then
                    if Registry."Contact No." <> Contact."No." then
                        exit(false);
            until Company.Next() = 0;

        RemoveOwnRegistration(Contact.Email);
        Contact.Email := NewEmail;
        Contact.Modify(true);
        AddOwnRegistration(NewEmail, Contact."No.");

        exit(true);
    end;

    local procedure RemoveOwnRegistration(Email: Text[80])
    var
        Registry: Record "CG X159 Email Registry";
    begin
        if Email = '' then
            exit;
        if Registry.Get(Email) then
            Registry.Delete();
    end;

    local procedure AddOwnRegistration(Email: Text[80]; ContactNo: Code[20])
    var
        Registry: Record "CG X159 Email Registry";
    begin
        if Email = '' then
            exit;
        Registry.Init();
        Registry.Email := Email;
        Registry."Contact No." := ContactNo;
        Registry.Insert(true);
    end;
}

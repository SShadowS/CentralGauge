table 70871 "CG X127 Job Card"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20])
        {
            DataClassification = CustomerContent;
        }
        field(2; "Site Code"; Code[10])
        {
            DataClassification = CustomerContent;

            trigger OnValidate()
            var
                SiteGuard: Codeunit "CG X127 Site Guard";
            begin
                SiteGuard.CheckSiteAllowed("Site Code");
            end;
        }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
    }
}

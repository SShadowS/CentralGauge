table 71370 "CG X153 Service Call"
{
    DataClassification = CustomerContent;
    Caption = 'CG X153 Service Call';

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            AutoIncrement = true;
            DataClassification = CustomerContent;
        }
        field(2; "Site Code"; Code[20])
        {
            Caption = 'Site Code';
            DataClassification = CustomerContent;
        }
        field(3; "Technician Code"; Code[20])
        {
            Caption = 'Technician Code';
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
        key(SiteTech; "Site Code", "Technician Code")
        {
        }
    }
}

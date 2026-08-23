table 70340 "CG X069 Queue Entry"
{
    DataClassification = CustomerContent;
    Caption = 'CG X069 Queue Entry';

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            AutoIncrement = true;
        }
        field(2; "Report Type"; Option)
        {
            Caption = 'Report Type';
            OptionMembers = Annual,Quarterly,Adhoc;
            OptionCaption = 'Annual,Quarterly,Adhoc';
        }
        field(3; "Source Record Id"; Guid)
        {
            Caption = 'Source Record Id';
        }
        field(4; "Queued At"; DateTime)
        {
            Caption = 'Queued At';
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
    }
}

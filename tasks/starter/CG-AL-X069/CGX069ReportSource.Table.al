table 70341 "CG X069 Report Source"
{
    DataClassification = CustomerContent;
    Caption = 'CG X069 Report Source';

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
        }
        field(2; "Report Type"; Option)
        {
            Caption = 'Report Type';
            OptionMembers = Annual,Quarterly,Adhoc;
            OptionCaption = 'Annual,Quarterly,Adhoc';
        }
        field(3; "Posting Date"; Date)
        {
            Caption = 'Posting Date';
        }
        field(4; "Description"; Text[100])
        {
            Caption = 'Description';
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

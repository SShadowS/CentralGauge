page 50206 "UI Sample PromptDialog"
{
    PageType = PromptDialog;
    Caption = 'Draft new project with Copilot';

    layout
    {
        area(Prompt)
        {
            field(ProjectDescription; InputProjectDescription)
            {
                ApplicationArea = All;
                ShowCaption = false;
                MultiLine = true;
                InstructionalText = 'Describe the project';
            }
        }
        area(Content)
        {
            field("Job Description"; JobDescription)
            {
                ApplicationArea = All;
                Caption = 'Project Description';
            }
        }
    }

    var
        InputProjectDescription: Text;
        JobDescription: Text;
}
